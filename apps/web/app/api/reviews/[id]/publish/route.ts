import crypto from "node:crypto";
import { prisma } from "@repo/db";
import { publishPullRequestReview } from "@repo/providers";
import { emitAfterRunUpdate } from "@repo/queue";
import {
  selectPublishableReviewComments,
  buildPublishedReviewBody,
} from "@repo/review";
import { logEvent } from "@repo/shared";

type Props = {
  params: Promise<{ id: string }>;
};

function getPreviewSource(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const source = (metadata as Record<string, unknown>).source;
  return typeof source === "string" ? source : null;
}

export async function POST(_: Request, { params }: Props) {
  const { id } = await params;

  const run = await prisma.reviewRun.findUnique({
    where: { id },
    include: {
      commentPreviews: true,
      publications: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!run) {
    return Response.json(
      { ok: false, error: "Review run not found" },
      { status: 404 }
    );
  }

  if (!run.githubInstallationId) {
    return Response.json(
      { ok: false, error: "Missing GitHub installation ID" },
      { status: 400 }
    );
  }

  if (!run.headSha) {
    return Response.json(
      { ok: false, error: "Missing head SHA" },
      { status: 400 }
    );
  }

  if (!["publish_ready", "completed"].includes(run.status)) {
    return Response.json(
      { ok: false, error: "Review run is not ready to publish yet" },
      { status: 409 }
    );
  }

  const [owner, repo] = run.repoId.split("/");

  if (!owner || !repo) {
    return Response.json(
      { ok: false, error: "Invalid repoId format" },
      { status: 400 }
    );
  }

  if (run.publishState === "published") {
    return Response.json({
      ok: true,
      skipped: true,
      reason: "already_published_for_run",
    });
  }

  if (run.publishState === "publishing") {
    return Response.json(
      {
        ok: false,
        skipped: true,
        reason: "publish_in_progress",
      },
      { status: 409 }
    );
  }

  const comments = selectPublishableReviewComments(run.commentPreviews, 5);

  if (comments.length === 0) {
    return Response.json({
      ok: true,
      skipped: true,
      reason: "no_publishable_comments",
    });
  }

  const body = buildPublishedReviewBody({
    repoId: run.repoId,
    prNumber: run.prNumber,
    totalFindings: run.commentPreviews.length,
    totalComments: comments.length,
    deterministicFindings: run.commentPreviews.filter(
      (preview) => getPreviewSource(preview.metadata) !== "ollama"
    ).length,
    llmFindings: run.commentPreviews.filter(
      (preview) => getPreviewSource(preview.metadata) === "ollama"
    ).length,
    summary: run.summary,
  });

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
    return Response.json(
      {
        ok: false,
        skipped: true,
        reason: "publish_lock_not_acquired",
      },
      { status: 409 }
    );
  }

  await emitAfterRunUpdate(run.id);

  const requestKey = crypto.randomUUID();

  let publication;

  try {
    publication = await prisma.reviewPublication.create({
      data: {
        reviewRunId: run.id,
        status: "publishing",
        requestKey,
        body,
      },
    });
  } catch (error) {
    await prisma.reviewRun.update({
      where: { id: run.id },
      data: {
        publishState: "failed",
      },
    });
    await emitAfterRunUpdate(run.id);

    if (
      error instanceof Error &&
      error.message.toLowerCase().includes("unique")
    ) {
      return Response.json(
        {
          ok: false,
          skipped: true,
          reason: "duplicate_publish_request",
        },
        { status: 409 }
      );
    }

    throw error;
  }

  try {
    const review = await publishPullRequestReview({
      installationId: run.githubInstallationId,
      owner,
      repo,
      pullNumber: run.prNumber,
      commitId: run.headSha,
      body,
      comments,
    });

    await prisma.reviewPublication.update({
      where: { id: publication.id },
      data: {
        githubReviewId: String(review.id),
        status: "published",
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

    return Response.json({
      ok: true,
      publicationId: publication.id,
      githubReviewId: String(review.id),
      commentsPublished: comments.length,
    });
  } catch (error: any) {
    await prisma.reviewPublication.update({
      where: { id: publication.id },
      data: {
        status: "failed",
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
      error: error?.message ?? "Unknown publish error",
    });

    return Response.json(
      {
        ok: false,
        error: error?.message ?? "Unknown publish error",
      },
      { status: 500 }
    );
  }
}
