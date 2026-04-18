import crypto from "node:crypto";
import { Prisma, prisma, pruneReviewRunHistory } from "@repo/db";
import { emitAfterRunUpdate, getReviewQueue } from "@repo/queue";
import { verifyGitHubWebhookSignature } from "@repo/providers";
import { getAppConfig, logEvent } from "@repo/shared";

const REVIEWABLE_ACTIONS = new Set([
  "opened",
  "reopened",
  "synchronize",
  "ready_for_review",
]);

export async function POST(req: Request) {
  const rawBody = await req.text();

  const signature = req.headers.get("x-hub-signature-256");
  const event = req.headers.get("x-github-event");
  const deliveryId = req.headers.get("x-github-delivery") ?? crypto.randomUUID();

  if (!verifyGitHubWebhookSignature(rawBody, signature)) {
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: any;

  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON payload", { status: 400 });
  }

  if (event === "ping") {
    return Response.json({ ok: true, event: "ping" });
  }

  try {
    await prisma.webhookDelivery.create({
      data: {
        githubDeliveryId: deliveryId,
        event: event ?? "unknown",
        action: payload.action ?? null,
        payload,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return Response.json({
        ok: true,
        ignored: true,
        reason: "duplicate_delivery",
      });
    }

    throw error;
  }

  if (event !== "pull_request") {
    return Response.json({ ok: true, ignored: true, reason: "unsupported_event" });
  }

  if (!REVIEWABLE_ACTIONS.has(payload.action)) {
    return Response.json({ ok: true, ignored: true, reason: "unsupported_action" });
  }

  if (payload.pull_request?.draft) {
    return Response.json({ ok: true, ignored: true, reason: "draft_pr" });
  }

  const installationId = payload.installation?.id;
  if (!installationId) {
    return new Response("Missing installation ID", { status: 400 });
  }

  await prisma.githubInstallation.upsert({
    where: { githubInstallationId: installationId },
    update: {
      accountLogin: payload.installation.account?.login ?? payload.repository.owner.login,
      accountType: payload.installation.account?.type ?? null,
    },
    create: {
      githubInstallationId: installationId,
      accountLogin: payload.installation.account?.login ?? payload.repository.owner.login,
      accountType: payload.installation.account?.type ?? null,
    },
  });

  const repoId = payload.repository.full_name;
  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const prNumber = payload.pull_request.number;
  const headSha = payload.pull_request.head.sha;
  const baseSha = payload.pull_request.base.sha;
  const title = payload.pull_request.title ?? null;
  const staleRuns = await prisma.reviewRun.findMany({
    where: {
      repoId,
      prNumber,
      headSha: { not: headSha },
      status: {
        notIn: ["completed", "failed", "stale"],
      },
    },
    select: {
      id: true,
    },
  });

  const existingRun = await prisma.reviewRun.findUnique({
    where: {
      repoId_prNumber_headSha: {
        repoId,
        prNumber,
        headSha,
      },
    },
  });

  if (existingRun) {
    return Response.json({
      ok: true,
      ignored: true,
      reason: "duplicate_run",
      reviewRunId: existingRun.id,
    });
  }

  const run = await prisma.$transaction(async (tx) => {
    await tx.reviewRun.updateMany({
      where: {
        repoId,
        prNumber,
        headSha: { not: headSha },
        status: {
          notIn: ["completed", "failed", "stale"],
        },
      },
      data: {
        status: "stale",
        error: "Superseded by a newer pull request head SHA.",
      },
    });

    return tx.reviewRun.create({
      data: {
        provider: "github",
        githubInstallationId: installationId,
        repoId,
        prNumber,
        headSha,
        baseSha,
        title,
        status: "queued",
        llmStatus: getAppConfig().llm.enabled ? "pending" : "disabled",
        publishState: "idle",
      },
    });
  });

  await Promise.all(
    staleRuns.map((staleRun) => emitAfterRunUpdate(staleRun.id))
  );
  if (staleRuns.length > 0) {
    try {
      await pruneReviewRunHistory(repoId);
    } catch (error) {
      logEvent("webhook.github", "warn", "Failed to prune old review runs", {
        repoId,
        error: error instanceof Error ? error.message : "Unknown prune error",
      });
    }
  }
  await emitAfterRunUpdate(run.id, "run_created");

  try {
    await getReviewQueue().add(
      "review-pr",
      {
        provider: "github",
        reviewRunId: run.id,
        installationId,
        owner,
        repo,
        repoId,
        prNumber,
        headSha,
        baseSha,
      },
      {
        jobId: `github_${owner}_${repo}_${prNumber}_${headSha}`,
      }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown queue enqueue error";

    await prisma.reviewRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        error: `Failed to enqueue review job: ${message}`,
        completedAt: new Date(),
      },
    });
    try {
      await pruneReviewRunHistory(repoId);
    } catch (error) {
      logEvent("webhook.github", "warn", "Failed to prune old review runs", {
        repoId,
        error: error instanceof Error ? error.message : "Unknown prune error",
      });
    }
    await emitAfterRunUpdate(run.id);

    logEvent("webhook.github", "error", "Failed to enqueue review job", {
      reviewRunId: run.id,
      deliveryId,
      repoId,
      prNumber,
      error: message,
    });

    return Response.json(
      {
        ok: false,
        error: "Failed to enqueue review job",
        reviewRunId: run.id,
      },
      { status: 500 }
    );
  }

  return Response.json({
    ok: true,
    queued: true,
    reviewRunId: run.id,
  });
}
