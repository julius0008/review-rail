import { prisma } from "@repo/db";
import { getRedisConnection } from "@repo/queue";
import { getAppConfig } from "@repo/shared";

export async function GET() {
  const checks = {
    db: "down",
    redis: "down",
    llm: getAppConfig().llm.enabled ? "configured" : "disabled",
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = "up";
  } catch {}

  try {
    await getRedisConnection().ping();
    checks.redis = "up";
  } catch {}

  const ok = checks.db === "up" && checks.redis === "up";

  return Response.json(
    {
      ok,
      ...checks,
    },
    { status: ok ? 200 : 503 }
  );
}
