import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const prisma = globalForPrisma.prisma ?? new PrismaClient();

export { prisma };

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

prisma.$connect().catch((err: unknown) => {
  console.error("[db] Failed to connect to database on startup:", err);
});

// TiDB Cloud Serverless closes idle connections after ~5 minutes, which
// surfaced as intermittent Prisma P1001 "can't reach database server"
// errors during low-traffic windows (the connection Prisma was holding had
// already been dropped server-side by the time the next request came in).
// The /api/health route also happens to touch the DB, but that only helps
// if an external uptime monitor is configured AND pings more often than
// TiDB's idle window — not something to depend on. A self-driven ping from
// inside the process guarantees the connection never sits idle long enough
// to be reclaimed, regardless of whether/how often anything external is
// hitting this instance. 4 minutes gives a safety margin under the 5-minute
// window without adding meaningful load. `.unref()` so this timer alone
// can't keep the process alive (e.g. during tests/scripts that import this
// module and expect to exit on their own).
const DB_KEEPALIVE_INTERVAL_MS = 4 * 60 * 1000;
const dbKeepAliveTimer = setInterval(() => {
  prisma.$queryRaw`SELECT 1`.catch((err: unknown) => {
    console.error("[db] keep-alive ping failed:", err);
  });
}, DB_KEEPALIVE_INTERVAL_MS);
if (dbKeepAliveTimer.unref) dbKeepAliveTimer.unref();
