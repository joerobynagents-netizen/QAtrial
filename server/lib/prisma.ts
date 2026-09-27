import { PrismaClient } from '../generated/prisma/index.js';
import { PrismaPg } from '@prisma/adapter-pg';

// DEOX SUB-1 patch (JOE-2435, 2026-08-26): Prisma 7 client engine requires a
// driver adapter. Upstream v3.0.0 ships bare `new PrismaClient()` which throws
// PrismaClientInitializationError at module load (server mode broken as shipped).
// The schema datasource has no url binding, so pass DATABASE_URL through the
// pg driver adapter explicitly.
const connectionString = process.env.DATABASE_URL;
const adapter = new PrismaPg(connectionString ? { connectionString } : {});

export const prisma = new PrismaClient({ adapter });
