import "dotenv/config";
import { Worker } from "bullmq";
import { prisma } from "@repo/db";
import { emitAfterRunUpdate, getRedisConnection } from "@repo/queue";
import { getAppConfig, logEvent, reviewJobSchema } from "@repo/shared";
import { runReviewJob } from "./review-runner";

const config = getAppConfig();

const worker = new Worker(
  "review-pr",
  async (job) => {
    const parsed = reviewJobSchema.parse(job.data);
    await runReviewJob(parsed);
  },
  { connection: getRedisConnection() }
);

worker.on("completed", (job) => {
  logEvent("worker.queue", "info", "Job completed", { jobId: job.id });
});

worker.on("failed", async (job, err) => {
  logEvent("worker.queue", "error", "Job failed", {
    jobId: job?.id,
    error: err.message,
  });

  const data = job?.data as { reviewRunId?: string } | undefined;
  if (!data?.reviewRunId) return;

  await prisma.reviewRun.update({
    where: { id: data.reviewRunId },
    data: {
      status: "failed",
      error: err.message,
      completedAt: new Date(),
    },
  });

  await emitAfterRunUpdate(data.reviewRunId);
});

logEvent("worker", "info", "Worker started", {
  nodeEnv: process.env.NODE_ENV ?? "development",
  appUrl: config.appUrl,
  llmEnabled: config.llm.enabled,
  llmProvider: config.llm.provider,
  autoPublish: config.reviewRail.autoPublish,
  blockingMode: config.reviewRail.blockingMode,
});

if (config.llm.enabled) {
  logEvent("worker", "info", "LLM augmentation enabled", {
    provider: config.llm.provider,
    model: config.llm.ollama.model,
    timeoutMs: config.llm.timeoutMs,
  });
} else {
  logEvent(
    "worker",
    "info",
    "LLM augmentation disabled; deterministic analyzers remain the production baseline",
    {
      ollamaConfigIgnored: Boolean(
        process.env.OLLAMA_BASE_URL || process.env.OLLAMA_MODEL
      ),
    }
  );
}
