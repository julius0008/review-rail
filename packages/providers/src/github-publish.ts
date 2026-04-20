import crypto from "node:crypto";
import { prisma } from "@repo/db";
import { emitAfterRunUpdate } from "@repo/queue";
import {
  buildFindingDelta,
  parseReviewRunMetadata,
  buildReviewPublicationPlan,
  type ReviewRailEvent,
} from "@repo/review";
import { logEvent } from "@repo/shared";
import { getInstallationOctokit } from "./github";

type ReviewCommentInput = {
  path: string;
  body: string;
  line: number;
  side: "RIGHT" | "LEFT";
  start_line?: number | null;
  start_side?: "RIGHT" | "LEFT" | null;
};

type PublishTrigger = "auto" | "manual";

function splitRepoId(repoId: string) {
  const [owner, repo] = repoId.split("/");

  if (!owner || !repo) {
    throw new Error("Invalid repoId format");
  }

  return { owner, repo };
}

export async function publishPullRequestReview(input: {
  installationId: number;
  owner: string;
  repo: string;
  pullNumber: number;
  commitId: string;
  body: string;
  event: ReviewRailEvent;
  comments: ReviewCommentInput[];
}) {
  const octokit = getInstallationOctokit(input.installationId);

  const { data } = await octokit.request(
    "POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
    {
      owner: input.owner,
      repo: input.repo,
      pull_number: input.pullNumber,
      commit_id: input.commitId,
      body: input.body,
      event: input.event,
      ...(input.comments.length > 0
        ? {
            comments: input.comments.map((comment) => ({
              path: comment.path,
              body: comment.body,
              line: comment.line,
              side: comment.side,
              ...(comment.start_line ? { start_line: comment.start_line } : {}),
              ...(comment.start_side ? { start_side: comment.start_side } : {}),
            })),
          }
        : {}),
      headers: {
        accept: "application/vnd.github+json",
      },
    }
  );

  return data;
}

export async function publishReviewRunToGitHub(input: {
  reviewRunId: string;
  trigger?: PublishTrigger;
}) {
  const trigger = input.trigger ?? "manual";
  const run = await prisma.reviewRun.findUnique({
    where: { id: input.reviewRunId },
    include: {
      findings: {
        orderBy: [{ path: "asc" }, { lineStart: "asc" }],
      },
      commentCandidates: {
        orderBy: [{ isPublishable: "desc" }, { path: "asc" }],
      },
      commentPreviews: {
        orderBy: [{ isValid: "desc" }, { path: "asc" }],
      },
      publications: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!run) {
    return {
      ok: false as const,
      skipped: false,
      error: "Review run not found",
      status: 404,
    };
  }

  if (!run.githubInstallationId) {
    return {
      ok: false as const,
      skipped: false,
      error: "Missing GitHub installation ID",
      status: 400,
    };
  }

  if (!run.headSha) {
    return {
      ok: false as const,
      skipped: false,
      error: "Missing head SHA",
      status: 400,
    };
  }

  if (!["publish_ready", "completed"].includes(run.status)) {
    return {
      ok: false as const,
      skipped: false,
      error: "Review run is not ready to publish yet",
      status: 409,
    };
  }

  if (run.publishState === "published") {
    return {
      ok: true as const,
      skipped: true,
      reason: "already_published_for_run",
    };
  }

  if (run.publishState === "publishing") {
    return {
      ok: false as const,
      skipped: true,
      reason: "publish_in_progress",
      status: 409,
    };
  }

  const previousRun = await prisma.reviewRun.findFirst({
    where: {
      repoId: run.repoId,
      prNumber: run.prNumber,
      id: { not: run.id },
      status: { not: "stale" },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      findings: {
        orderBy: [{ path: "asc" }, { lineStart: "asc" }],
      },
    },
  });

  const latestPublishedPublication = await prisma.reviewPublication.findFirst({
    where: {
      reviewRun: {
        is: {
          repoId: run.repoId,
          prNumber: run.prNumber,
          id: { not: run.id },
        },
      },
      status: "published",
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const runMetadata = parseReviewRunMetadata(run.runMetadata);

  const plan = buildReviewPublicationPlan({
    repoId: run.repoId,
    prNumber: run.prNumber,
    summary: run.summary,
    findings: run.findings,
    commentCandidates: run.commentCandidates,
    commentPreviews: run.commentPreviews,
    latestPublishedReviewEvent: latestPublishedPublication?.reviewEvent ?? null,
    delta: previousRun
      ? buildFindingDelta({
          currentFindings: run.findings,
          previousFindings: previousRun.findings,
        })
      : null,
    coverage: runMetadata?.coverage ?? null,
  });

  if (!plan.shouldPublish || !plan.event || !plan.body) {
    return {
      ok: true as const,
      skipped: true,
      reason: plan.decisionReason,
      reviewOutcome: plan.reviewOutcome,
      blockingReason: plan.blockingReason,
    };
  }

  const publishLock = await prisma.reviewRun.updateMany({
    where: {
      id: run.id,
      publishState: {
        in: ["idle", "failed"],
      },
    },
    data: {
      publishState: "publishing",
    },
  });

  if (publishLock.count === 0) {
    return {
      ok: false as const,
      skipped: true,
      reason: "publish_lock_not_acquired",
      status: 409,
    };
  }

  await emitAfterRunUpdate(run.id);

  const requestKey = crypto.randomUUID();
  const publication = await prisma.reviewPublication.create({
    data: {
      reviewRunId: run.id,
      status: "publishing",
      reviewEvent: plan.event,
      commentsCount: plan.comments.length,
      requestKey,
      body: plan.body,
    },
  });

  try {
    const { owner, repo } = splitRepoId(run.repoId);
    const review = await publishPullRequestReview({
      installationId: run.githubInstallationId,
      owner,
      repo,
      pullNumber: run.prNumber,
      commitId: run.headSha,
      body: plan.body,
      event: plan.event,
      comments: plan.comments,
    });

    await prisma.reviewPublication.update({
      where: { id: publication.id },
      data: {
        githubReviewId: String(review.id),
        status: "published",
        reviewEvent: plan.event,
        commentsCount: plan.comments.length,
        submittedAt: new Date(),
        error: null,
      },
    });

    await prisma.reviewRun.update({
      where: { id: run.id },
      data: {
        publishState: "published",
        status: "completed",
        publishedAt: new Date(),
      },
    });
    await emitAfterRunUpdate(run.id);

    logEvent("publish.github", "info", "Published Observer GitHub review", {
      reviewRunId: run.id,
      publicationId: publication.id,
      githubReviewId: String(review.id),
      event: plan.event,
      commentsCount: plan.comments.length,
      trigger,
      reviewOutcome: plan.reviewOutcome,
      coverageMode: runMetadata?.coverage.mode ?? null,
      coverageSummary: plan.coverageSummary,
    });

    return {
      ok: true as const,
      publicationId: publication.id,
      githubReviewId: String(review.id),
      event: plan.event,
      commentsPublished: plan.comments.length,
      reviewOutcome: plan.reviewOutcome,
      blockingReason: plan.blockingReason,
      selectedPreviewIds: plan.selectedPreviewIds,
    };
  } catch (error: any) {
    await prisma.reviewPublication.update({
      where: { id: publication.id },
      data: {
        status: "failed",
        reviewEvent: plan.event,
        commentsCount: plan.comments.length,
        error: error?.message ?? "Unknown publish error",
      },
    });

    await prisma.reviewRun.update({
      where: { id: run.id },
      data: {
        publishState: "failed",
      },
    });
    await emitAfterRunUpdate(run.id);

    logEvent("publish.github", "error", "Failed to publish GitHub review", {
      reviewRunId: run.id,
      publicationId: publication.id,
      event: plan.event,
      trigger,
      error: error?.message ?? "Unknown publish error",
    });

    throw error;
  }
}
