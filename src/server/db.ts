import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function create() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  return new PrismaClient({ adapter });
}

// In dev the client is kept across hot reloads. After `prisma generate` the PrismaClient class is a new
// module, so a cached instance from the old schema is no longer `instanceof` it — replace it instead of
// serving queries with a stale schema ("Unknown field …" errors until the server restarts).
const cached = globalForPrisma.prisma;
export const db = cached instanceof PrismaClient ? cached : create();
if (cached && cached !== db) void cached.$disconnect().catch(() => {});
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
