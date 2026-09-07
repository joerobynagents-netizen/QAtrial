// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { db, webhook } = vi.hoisted(() => {
  vi.stubEnv('JWT_SECRET', 'qatrial-document-tests-only-secret-32-characters');
  return {
    db: {
      document: { findUnique: vi.fn() },
      project: { findFirst: vi.fn() },
      $transaction: vi.fn(),
    },
    webhook: vi.fn(),
  };
});
vi.mock('../lib/prisma.js', () => ({ prisma: db }));
vi.mock('../services/webhook.service.js', () => ({ dispatchWebhook: webhook }));

import documents from './documents.js';
import { signAccessToken } from '../middleware/auth.js';

type Doc = { id: string; projectId: string; currentVersion: string; status: string; updatedAt: number };
type Version = { id: string; documentId: string; version: string; content: string; approvedBy?: string };
type Data<T> = { data: T };
let state: { doc: Doc | null; versions: Version[]; audits: unknown[] };
let failAt: 'version' | 'audit' | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  state = {
    doc: { id: 'doc-1', projectId: 'project-1', currentVersion: '1.0', status: 'in_review', updatedAt: 1 },
    versions: [{ id: 'ver-1', documentId: 'doc-1', version: '1.0', content: 'Original content' }],
    audits: [],
  };
  failAt = undefined;
  db.project.findFirst.mockResolvedValue({ id: 'project-1' });
  db.document.findUnique.mockImplementation(async () => state.doc && structuredClone({
    ...state.doc, versions: state.versions.slice(-1),
  }));

  // A transactional persistence double: serialize writers, publish only on commit.
  // No PostgreSQL instance or deployment credentials are used by these contracts.
  let pending = Promise.resolve();
  db.$transaction.mockImplementation((callback) => {
    const result = pending.then(async () => {
      const draft = structuredClone(state);
      const tx = {
        document: {
          create: async ({ data }: Data<Doc & { versions: { create: Omit<Version, 'id' | 'documentId'> } }>) => {
            const { versions, ...doc } = data;
            draft.doc = { ...doc, id: 'doc-1', updatedAt: 1 };
            if (failAt === 'version') throw new Error('Version storage unavailable');
            draft.versions.push({ ...versions.create, id: 'ver-1', documentId: 'doc-1' });
            return draft.doc;
          },
          updateMany: async ({ where, data }: { where: Partial<Doc>; data: Partial<Doc> }) => {
            if (!draft.doc || !Object.entries(where).every(([key, value]) => draft.doc![key as keyof Doc] === value)) {
              return { count: 0 };
            }
            Object.assign(draft.doc, data, { updatedAt: draft.doc.updatedAt + 1 });
            return { count: 1 };
          },
          findUniqueOrThrow: async () => {
            if (!draft.doc) throw new Error('Missing document');
            return draft.doc;
          },
        },
        documentVersion: {
          findFirst: async ({ where }: { where: { documentId: string; version: string } }) =>
            draft.versions.find((v) => v.documentId === where.documentId && v.version === where.version),
          create: async ({ data }: Data<Omit<Version, 'id'>>) => {
            if (failAt === 'version') throw new Error('Version storage unavailable');
            const version = { ...data, id: `ver-${draft.versions.length + 1}` };
            draft.versions.push(version);
            return version;
          },
          update: async ({ where, data }: { where: { id: string }; data: Partial<Version> }) => {
            if (failAt === 'version') throw new Error('Version storage unavailable');
            const version = draft.versions.find((v) => v.id === where.id);
            if (!version) throw new Error('Missing version');
            return Object.assign(version, data);
          },
        },
        auditLog: {
          create: async ({ data }: Data<unknown>) => {
            if (failAt === 'audit') throw new Error('Audit storage unavailable');
            draft.audits.push(data);
          },
        },
      };
      const value = await callback(tx);
      state = draft;
      return value;
    });
    pending = result.then(() => undefined, () => undefined);
    return result;
  });
});

afterEach(() => vi.restoreAllMocks());

function request(path: string, body: unknown, method = 'POST') {
  return documents.request(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${signAccessToken({ userId: 'user-1', email: 'qa@example.invalid', role: 'qa_manager', orgId: 'org-1' })}`,
    },
    body: JSON.stringify(body),
  });
}

describe('document version transactions', () => {
  it('creates the document, initial content, and audit together', async () => {
    state = { doc: null, versions: [], audits: [] };
    const response = await request('/', { projectId: 'project-1', title: 'SOP', content: 'Initial text' });
    expect(response.status).toBe(201);
    expect(state.doc?.currentVersion).toBe('1.0');
    expect(state.versions[0].content).toBe('Initial text');
    expect(state.audits).toHaveLength(1);
  });

  it.each(['version', 'audit'] as const)('rolls back initial creation when %s storage fails', async (failure) => {
    state = { doc: null, versions: [], audits: [] };
    failAt = failure;
    expect((await request('/', { projectId: 'project-1', title: 'SOP' })).status).toBe(500);
    expect(state).toEqual({ doc: null, versions: [], audits: [] });
    expect(webhook).not.toHaveBeenCalled();
  });

  it.each(['version', 'audit'] as const)('rolls back a new version when %s storage fails', async (failure) => {
    const before = structuredClone(state);
    failAt = failure;
    expect((await request('/doc-1/versions', { content: 'New text', changeReason: 'Correction' })).status).toBe(500);
    expect(state).toEqual(before);
  });

  it('copies the declared current version, not the last history record', async () => {
    state.versions.push({ id: 'ver-orphan', documentId: 'doc-1', version: '0.9', content: 'Wrong content' });
    const response = await request('/doc-1/versions', { changeReason: 'Revision', majorVersion: true });
    expect(response.status).toBe(201);
    expect(state.versions.at(-1)).toMatchObject({ version: '2.0', content: 'Original content' });
    expect(state.doc).toMatchObject({ currentVersion: '2.0', status: 'draft' });
  });

  it('preserves explicitly empty replacement content', async () => {
    expect((await request('/doc-1/versions', { changeReason: 'Clear content', content: '' })).status).toBe(201);
    expect(state.versions.at(-1)?.content).toBe('');
  });

  it('rejects overlapping writers without duplicating a version', async () => {
    const responses = await Promise.all([
      request('/doc-1/versions', { changeReason: 'First', content: 'First' }),
      request('/doc-1/versions', { changeReason: 'Second', content: 'Second' }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(state.versions.map((v) => v.version)).toEqual(['1.0', '1.1']);
    expect(state.audits).toHaveLength(1);
  });

  it('rejects missing current content without advancing the version', async () => {
    state.versions = [];
    const before = structuredClone(state);
    expect((await request('/doc-1/versions', { changeReason: 'Revision' })).status).toBe(409);
    expect(state).toEqual(before);
  });

  it('rejects blank change reasons before writing', async () => {
    expect((await request('/doc-1/versions', { changeReason: '  ' })).status).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('does not duplicate a version left by an earlier partial write', async () => {
    state.versions.push({ id: 'ver-orphan', documentId: 'doc-1', version: '1.1', content: 'Preserve this' });
    const before = structuredClone(state);
    expect((await request('/doc-1/versions', { changeReason: 'Revision' })).status).toBe(409);
    expect(state).toEqual(before);
  });

  it('rejects invalid stored version numbers before writing', async () => {
    state.doc!.currentVersion = '1.invalid';
    expect((await request('/doc-1/versions', { changeReason: 'Revision' })).status).toBe(409);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('approves the current version even when history has a newer record', async () => {
    state.versions.push({ id: 'ver-orphan', documentId: 'doc-1', version: '0.9', content: 'Old' });
    expect((await request('/doc-1/review', { status: 'approved' }, 'PUT')).status).toBe(200);
    expect(state.versions[0].approvedBy).toBe('user-1');
    expect(state.versions[1].approvedBy).toBeUndefined();
    expect(state.doc?.status).toBe('approved');
  });

  it.each(['version', 'audit'] as const)('rolls back approval when %s storage fails', async (failure) => {
    const before = structuredClone(state);
    failAt = failure;
    expect((await request('/doc-1/review', { status: 'approved' }, 'PUT')).status).toBe(500);
    expect(state).toEqual(before);
    expect(webhook).not.toHaveBeenCalled();
  });

  it('does not approve a revision created during the review request', async () => {
    const responses = await Promise.all([
      request('/doc-1/versions', { changeReason: 'Revision', content: 'Unreviewed' }),
      request('/doc-1/review', { status: 'approved' }, 'PUT'),
    ]);
    expect(responses.map((r) => r.status)).toEqual([201, 409]);
    expect(state.doc).toMatchObject({ currentVersion: '1.1', status: 'draft' });
    expect(state.versions.every((v) => !v.approvedBy)).toBe(true);
  });
});
