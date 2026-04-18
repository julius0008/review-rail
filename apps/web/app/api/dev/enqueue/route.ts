import { prisma } from "@repo/db";
import { emitAfterRunUpdate, getReviewQueue } from "@repo/queue";
import { redirect } from "next/navigation";
import { getAppConfig } from "@repo/shared";

export async function POST() {
  const run = await prisma.reviewRun.create({
    data: {
      repoId: "demo/repo",
      prNumber: Math.floor(Math.random() * 100) + 1,
      headSha: crypto.randomUUID().replace(/-/g, ""),
      baseSha: crypto.randomUUID().replace(/-/g, ""),
      status: "queued",
      llmStatus: getAppConfig().llm.enabled ? "pending" : "disabled",
    },
  });

  await emitAfterRunUpdate(run.id, "run_created");

  await getReviewQueue().add(
    "review-pr",
    {
      provider: "github",
      reviewRunId: run.id,
      installationId: 1,
      owner: "demo",
      repo: "repo",
      repoId: run.repoId,
      prNumber: run.prNumber,
      headSha: run.headSha,
      baseSha: run.baseSha ?? undefined,
    },
    {
      jobId: `demo_${run.prNumber}_${run.headSha}`,
    }
  );

  redirect("/");
}
