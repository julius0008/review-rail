import { PrismaClient, Prisma } from "./generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

const TERMINAL_REVIEW_RUN_STATUSES = [
  "publish_ready",
  "completed",
  "failed",
  "stale",
] as const;

export async function pruneReviewRunHistory(repoId: string, keepLatest = 12) {
  const staleRuns = await prisma.reviewRun.findMany({
    where: {
      repoId,
      status: {
        in: [...TERMINAL_REVIEW_RUN_STATUSES],
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: keepLatest,
    select: {
      id: true,
    },
  });

  if (staleRuns.length === 0) {
    return 0;
  }

  const result = await prisma.reviewRun.deleteMany({
    where: {
      id: {
        in: staleRuns.map((run) => run.id),
      },
    },
  });

  return result.count;
}

export { Prisma };
