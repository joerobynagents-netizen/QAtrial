# Runbook — Local Windows Deployment & Auth Verification

JOE-2435 SUB-1. Verified working 2026-09-25 on DESKTOP-HQR7IKJ (Windows 11, Node 24, PostgreSQL 17, PowerShell).

## Prerequisites

- Node.js 24+ and npm
- PostgreSQL 17 running locally (database `qatrial`)
- Repo at `E:\Projects\QAtrial` with a `.env` file containing at minimum:
  - `DATABASE_URL=postgresql://<user>:<password>@localhost:5432/qatrial`
  - `JWT_ACCESS_SECRET=`, `JWT_REFRESH_SECRET=` (32+ random chars each)
- Tooling scripts at `E:\DEOX\QAtrial-tools\` (outside the repo)

## 1. Database setup

One-time schema push + seed (idempotent — safe to re-run):

```powershell
powershell -File E:\DEOX\QAtrial-tools\setup-db.ps1
```

Manual equivalent:

```powershell
cd E:\Projects\QAtrial
npm install
npm run db:generate
npm run db:push
```

## 2. Start the API server (server mode, :3001)

```powershell
powershell -File E:\DEOX\QAtrial-tools\start-server.ps1
```

This loads `.env` into the process, then runs `npx tsx server/index.ts`. The server listens on `http://localhost:3001`. First admin user auto-provisions on the first successful register call if no users exist.

## 3. Verify the auth flow end-to-end

With the server running:

```powershell
node E:\DEOX\QAtrial-tools\verify-sub1-auth.mjs
```

Checks (all must print `PASS`):
1. Admin register → login → `/api/auth/me` returns the admin user
2. `POST /api/users/invite` issues a QA-user with a temporary password (invite route, **not** `POST /api/users`)
3. QA user logs in with the temp password and `/api/auth/me` confirms role `qa_user`
4. JWT access token expiry matches config

## 4. Test gates (run before declaring SUB-1 done)

```powershell
cd E:\Projects\QAtrial
npm run typecheck        # tsc -b && tsc -p tsconfig.server.json
npm test                 # unit tests (37/37)
npm run test:server      # contract tests (45/45) — REQUIRES .env vars loaded first!
```

**Windows gotcha:** `test:server` needs env vars that docker-compose normally injects. Load `.env` into the session first:

```powershell
Get-Content .env | Where-Object { $_ -match '^[A-Z_][A-Z0-9_]*=' } | ForEach-Object {
  $p = $_ -split '=', 2; [Environment]::SetEnvironmentVariable($p[0], $p[1], 'Process')
}
npm run test:server
```

## 5. Cleanup (failed probe runs)

If `verify-sub1-auth.mjs` aborts mid-run it can leave probe rows. Cleanup SQL is templated in `C:\Users\JDTho\.openclaw\workspace_fresh\tmp\qatrial-cleanup.sql` — delete by exact probe emails/org names only; never blanket-delete from `User`/`Organization`.

## Patches applied under JOE-2435 (SUB-1)

These are Windows/ESM fixes local to this deployment — marked with `DEOX SUB-1 patch (JOE-2435)` comments:

| File | Patch |
|------|-------|
| `server/middleware/auth.ts` | `jsonwebtoken` 9.0.3 ESM interop: use `.default ?? namespace` when importing |
| `server/routes/auditmode.ts` | same JWT ESM interop fix |
| `server/routes/realtime.ts` | same JWT ESM interop fix (dynamic import) |
| `server/app.contract.test.ts` | `path.join('/tmp', …)` → `path.join(os.tmpdir(), …)` (hardcoded `/tmp` resolves to `<drive>\tmp` on Windows → ENOENT) |
| `server/app.contract.test.ts` | added missing `prisma.project.findFirst` mocks in approvals + evidence tests (route access-check via `findAccessibleProject` was unmocked upstream → spurious 404/empty-list failures) |

## Known non-issues

- `POST /api/users` 404 is correct — user creation is `POST /api/users/invite` (returns `temporaryPassword`).
- Server binds 3001 only when `PORT`/compose not present; kill via `Get-NetTCPConnection -LocalPort 3001` → `Stop-Process` if a stale instance holds the port.
