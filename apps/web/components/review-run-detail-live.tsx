"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { ReviewRunDetailDto } from "@/lib/review-run-types";
import {
  buildFindingsByPath,
  buildSummarySentence,
  findingCardClass,
  formatDateTime,
  formatReviewEventLabel,
  formatRuleLabel,
  formatSourceLabel,
  getDisplayFindingTitle,
  getTopFindings,
  llmStatusClass,
  publicationStatusClass,
  publishStateClass,
  readJsonArray,
  readJsonObject,
  ReviewOutcomePill,
  severityBadgeClass,
  StatusPill,
} from "./review-ui";
import { ObserverShell } from "./observer-shell";
import {
  type LiveConnectionState,
  useLiveSnapshot,
} from "./use-live-snapshot";

const terminalStatuses = new Set(["publish_ready", "completed", "failed", "stale"]);

function liveIndicatorClass(state: LiveConnectionState) {
  if (state === "live") return "bg-emerald-500/12 text-emerald-200 ring-1 ring-emerald-400/25";
  if (state === "reconnecting") {
    return "bg-amber-500/12 text-amber-200 ring-1 ring-amber-400/25";
  }
  if (state === "polling") return "bg-sky-500/12 text-sky-200 ring-1 ring-sky-400/25";
  return "bg-white/6 text-slate-300 ring-1 ring-white/8";
}

function liveIndicatorLabel(state: LiveConnectionState) {
  if (state === "live") return "Live";
  if (state === "reconnecting") return "Reconnecting";
  if (state === "polling") return "Polling";
  return "Connecting";
}

type Props = {
  initialSnapshot: ReviewRunDetailDto;
};

export function ReviewRunDetailLive({ initialSnapshot }: Props) {
  const router = useRouter();
  const { data: run, connectionState } = useLiveSnapshot({
    initialData: initialSnapshot,
    fetchUrl: `/api/review-runs/${initialSnapshot.id}`,
    streamUrl: `/api/review-runs/${initialSnapshot.id}/stream`,
    pollIntervalMs: 3000,
    shouldContinuePolling: (snapshot) => !terminalStatuses.has(snapshot.status),
  });
  const [manualPublishState, setManualPublishState] = useState<{
    status: "idle" | "pending" | "done" | "error";
    message?: string;
  }>({ status: "idle" });

  const findingsByPath = useMemo(
    () => Array.from(buildFindingsByPath(run.findings).entries()),
    [run.findings]
  );
  const summary = run.summary ?? buildSummarySentence(run.findings);
  const blockingCandidates = run.commentCandidates.filter((candidate) => candidate.isPublishable);
  const suppressedCandidates = run.commentCandidates.filter(
    (candidate) => !candidate.isPublishable
  );
  const validPreviews = run.commentPreviews.filter((preview) => preview.isValid);
  const skippedPreviews = run.commentPreviews.filter((preview) => !preview.isValid);
  const publishedPreviewIdSet = useMemo(
    () => new Set(run.publishedPreviewIds),
    [run.publishedPreviewIds]
  );
  const publishedPreviews = validPreviews.filter((preview) =>
    publishedPreviewIdSet.has(preview.id)
  );
  const publishedCandidateIdSet = new Set(
    publishedPreviews.flatMap((preview) => (preview.candidateId ? [preview.candidateId] : []))
  );
  const publishedCandidates = run.commentCandidates.filter((candidate) =>
    publishedCandidateIdSet.has(candidate.id)
  );
  const blockingFindingKeys = new Set(
    blockingCandidates.flatMap((candidate) =>
      candidate.findingId
        ? [candidate.findingId]
        : candidate.findingFingerprint
          ? [candidate.findingFingerprint]
          : []
    )
  );
  const blockingFindings = run.findings.filter(
    (finding) =>
      blockingFindingKeys.has(finding.id) ||
      (finding.fingerprint ? blockingFindingKeys.has(finding.fingerprint) : false)
  );
  const topPriorityFindings =
    blockingFindings.length > 0 ? blockingFindings.slice(0, 5) : getTopFindings(run.findings);
  const remainingFindings = run.findings.filter(
    (finding) =>
      !blockingFindingKeys.has(finding.id) &&
      !(finding.fingerprint ? blockingFindingKeys.has(finding.fingerprint) : false)
  );
  const llmMetadata = readJsonObject(run.llmMetadata);
  const llmParseErrors = readJsonArray(llmMetadata?.parseErrors);
  const llmBundles = readJsonArray(llmMetadata?.bundles);
  const canManuallyPublish =
    ["publish_ready", "completed"].includes(run.status) && run.publishState !== "publishing";

  async function handleManualPublish() {
    setManualPublishState({ status: "pending" });

    try {
      const response = await fetch(`/api/reviews/${run.id}/publish`, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        ok: boolean;
        skipped?: boolean;
        reason?: string;
        event?: string;
        error?: string;
      };

      if (!response.ok || !payload.ok) {
        setManualPublishState({
          status: "error",
          message: payload.error ?? "Publish failed.",
        });
        return;
      }

      setManualPublishState({
        status: "done",
        message: payload.skipped
          ? `Publish skipped: ${payload.reason ?? "no review needed"}`
          : `Published ${payload.event?.toLowerCase() ?? "review"} to GitHub.`,
      });
    } catch (error) {
      setManualPublishState({
        status: "error",
        message: error instanceof Error ? error.message : "Unknown publish error",
      });
    }
  }

  return (
    <ObserverShell
      eyebrow={`${run.repoId} · PR #${run.prNumber}`}
      title={run.title ?? "Run details"}
      description={
        run.mergeBlockReason ??
        (run.reviewOutcome === "clean"
          ? "Observer does not see merge-blocking findings in this run."
          : run.reviewOutcome === "comment_only"
            ? "Observer still has follow-up notes, but this run is not strong enough to block merge."
            : run.error ?? summary)
      }
      connectionState={connectionState}
      headerActions={
        <>
          <ReviewOutcomePill outcome={run.reviewOutcome} />
          <StatusPill status={run.status} />
          <span
            className={`rounded-full px-3 py-2 text-xs font-medium ${publishStateClass(
              run.publishState
            )}`}
          >
            Publish {run.publishState}
          </span>
          <span
            className={`rounded-full px-3 py-2 text-xs font-medium ${llmStatusClass(
              run.llmStatus
            )}`}
          >
            LLM {run.llmStatus}
          </span>
          <span
            className={`rounded-full px-3 py-2 text-xs font-medium ${liveIndicatorClass(
              connectionState
            )}`}
          >
            {liveIndicatorLabel(connectionState)}
          </span>
        </>
      }
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_360px]">
        <div className="space-y-6">
          <section className="observer-panel rounded-[1.75rem] p-6 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                    {run.repoId}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                    PR #{run.prNumber}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono">
                    {run.headSha.slice(0, 8)}
                  </span>
                  {run.baseSha ? (
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono">
                      base {run.baseSha.slice(0, 8)}
                    </span>
                  ) : null}
                </div>

                <div className="mt-5 max-w-3xl text-sm leading-7 text-slate-300">
                  Observer already handled the routine PR review in GitHub. This page keeps the
                  deeper story: why this verdict happened, what got published, what was skipped,
                  and what changed since the previous run.
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (window.history.length > 1) {
                      router.back();
                      return;
                    }

                    router.push("/");
                  }}
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100 hover:border-white/20 hover:bg-white/8"
                >
                  Back to overview
                </button>
                <a
                  href={run.pullRequestUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-2xl border border-sky-400/20 bg-sky-500/10 px-4 py-2 text-sm font-medium text-sky-100 hover:border-sky-300/30 hover:bg-sky-500/14"
                >
                  Open PR
                </a>
              </div>
            </div>

            <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_320px]">
              <div className="rounded-[1.5rem] border border-white/10 bg-black/25 p-5">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  Why Observer chose this review
                </div>
                <div className="mt-3 text-xl font-semibold text-white">
                  {run.reviewOutcome === "blocking"
                    ? "Merge is blocked by Observer"
                    : run.reviewOutcome === "comment_only"
                      ? "Observer published follow-up notes only"
                      : run.reviewOutcome === "clean"
                        ? "Observer is clear to merge"
                        : run.reviewOutcome === "failed"
                          ? "Observer could not finish the review"
                          : "Observer is still processing this run"}
                </div>
                <p className="mt-3 text-sm leading-7 text-slate-300">
                  {run.mergeBlockReason ??
                    (run.reviewOutcome === "clean"
                      ? "No merge-blocking findings remain in this run."
                      : run.reviewOutcome === "comment_only"
                        ? "Observer still has useful follow-up items, but they are not strong enough to block merge."
                        : run.error ?? summary)}
                </p>
                <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-400">
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                    {blockingFindings.length} blocking
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                    {run.lastPublication?.commentsCount ?? publishedPreviews.length} published
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                    {suppressedCandidates.length} suppressed
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                    {skippedPreviews.length} invalid anchors
                  </span>
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-white/10 bg-black/25 p-5">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  What to do next
                </div>
                <div className="mt-3 space-y-3 text-sm leading-7 text-slate-300">
                  {run.reviewOutcome === "blocking" ? (
                    <>
                      <p>Fix the highest-priority findings first.</p>
                      <p>Push a new commit to trigger an automatic rerun.</p>
                    </>
                  ) : run.reviewOutcome === "comment_only" ? (
                    <>
                      <p>Use the PR comments for the quick fixes.</p>
                      <p>Use this page for the suppressed findings and skipped anchors.</p>
                    </>
                  ) : run.reviewOutcome === "clean" ? (
                    <>
                      <p>Observer has cleared its review for this run.</p>
                      <p>Only stay here if you want the publication trail or run comparison.</p>
                    </>
                  ) : (
                    <>
                      <p>Watch the live state or retry publishing if this run has already completed.</p>
                      <p>Open the technical details if the failure reason is not obvious.</p>
                    </>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="observer-panel rounded-[1.75rem] p-6">
            <div className="observer-kicker">Priority issues</div>
            <h2 className="mt-3 text-xl font-semibold text-white">What should get fixed first</h2>
            <p className="mt-2 text-sm text-slate-400">
              These are the issues most likely to explain the current verdict.
            </p>

            {topPriorityFindings.length > 0 ? (
              <div className="mt-5 space-y-3">
                {topPriorityFindings.map((finding) => (
                  <div key={finding.id} className={findingCardClass(finding.severity)}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-white">
                          {getDisplayFindingTitle(
                            finding.title,
                            finding.ruleId,
                            finding.explanation
                          )}{" "}
                          · {finding.path}:{finding.lineStart}
                        </div>
                        <div className="mt-2 text-sm leading-7 text-slate-200">
                          {finding.explanation}
                        </div>
                        {finding.actionableFix ? (
                          <div className="mt-3 rounded-2xl border border-white/10 bg-black/15 px-3 py-2 text-sm text-slate-300">
                            Suggested fix: {finding.actionableFix}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-1 text-xs ${severityBadgeClass(
                            finding.severity
                          )}`}
                        >
                          {finding.severity}
                        </span>
                        <span className="rounded-full bg-white/5 px-2 py-1 text-xs uppercase tracking-wide text-slate-300">
                          {formatSourceLabel(finding.source)}
                        </span>
                        {finding.ruleId ? (
                          <span className="rounded-full bg-white/5 px-2 py-1 text-xs text-slate-300">
                            {formatRuleLabel(finding.ruleId)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-5 rounded-[1.25rem] border border-dashed border-white/10 p-6 text-sm text-slate-400">
                No priority findings remain in this run.
              </div>
            )}
          </section>

          <section className="observer-panel rounded-[1.75rem] p-6">
            <div className="observer-kicker">Published to GitHub</div>
            <h2 className="mt-3 text-xl font-semibold text-white">What Observer posted</h2>
            <p className="mt-2 text-sm text-slate-400">
              This is the exact review body attached to the GitHub review event for this run.
            </p>

            {run.lastPublication?.body ? (
              <pre className="mt-5 overflow-x-auto rounded-[1.25rem] border border-white/10 bg-black/25 p-5 text-sm leading-7 whitespace-pre-wrap text-slate-200">
                {run.lastPublication.body}
              </pre>
            ) : (
              <div className="mt-5 rounded-[1.25rem] border border-dashed border-white/10 p-6 text-sm text-slate-400">
                No GitHub review summary has been posted for this run yet.
              </div>
            )}
          </section>

          <section className="observer-panel rounded-[1.75rem] p-6">
            <div className="observer-kicker">Published inline comments</div>
            <h2 className="mt-3 text-xl font-semibold text-white">
              The comments that made it through
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              These are the actual inline comments attached to the latest published review.
            </p>

            {publishedPreviews.length > 0 ? (
              <div className="mt-5 space-y-3">
                {publishedPreviews.map((preview) => (
                  <div
                    key={preview.id}
                    className="rounded-[1.25rem] border border-emerald-500/20 bg-emerald-500/10 p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
                      <span className="rounded-full bg-black/20 px-2 py-1">{preview.path}</span>
                      {preview.line ? (
                        <span className="rounded-full bg-black/20 px-2 py-1">
                          line {preview.line}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-100">
                      {preview.body}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-5 rounded-[1.25rem] border border-dashed border-white/10 p-6 text-sm text-slate-400">
                No inline comments were published for this run.
              </div>
            )}
          </section>

          {run.delta ? (
            <section className="observer-panel rounded-[1.75rem] p-6">
              <div className="observer-kicker">Change since previous run</div>
              <h2 className="mt-3 text-xl font-semibold text-white">What changed this time</h2>
              <p className="mt-2 text-sm text-slate-400">
                Use this section to see whether the latest push resolved issues or just moved them.
              </p>

              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-emerald-100/80">
                    Resolved
                  </div>
                  <div className="mt-2 text-3xl font-semibold text-white">
                    {run.delta.resolvedFindings}
                  </div>
                </div>
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-amber-100/80">
                    New
                  </div>
                  <div className="mt-2 text-3xl font-semibold text-white">
                    {run.delta.newFindings}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    Persistent
                  </div>
                  <div className="mt-2 text-3xl font-semibold text-white">
                    {run.delta.persistentFindings}
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          <section className="observer-panel rounded-[1.75rem] p-6">
            <div className="observer-kicker">Findings by file</div>
            <h2 className="mt-3 text-xl font-semibold text-white">Where Observer is focusing</h2>
            <p className="mt-2 text-sm text-slate-400">
              GitHub shows the comments. This view shows the grouped reasoning behind them.
            </p>

            {findingsByPath.length > 0 ? (
              <div className="mt-5 space-y-4">
                {findingsByPath.map(([path, groupedFindings]) => (
                  <div
                    key={path}
                    className="rounded-[1.35rem] border border-white/10 bg-black/20 p-5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-base font-semibold text-white">{path}</div>
                        <div className="mt-1 text-sm text-slate-400">
                          {groupedFindings.length} finding
                          {groupedFindings.length === 1 ? "" : "s"} in this file
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 space-y-3">
                      {groupedFindings.map((finding) => (
                        <div key={finding.id} className={findingCardClass(finding.severity)}>
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <div className="text-sm font-semibold text-white">
                                {getDisplayFindingTitle(
                                  finding.title,
                                  finding.ruleId,
                                  finding.explanation
                                )}{" "}
                                · line {finding.lineStart}
                              </div>
                              <div className="mt-2 text-sm leading-7 text-slate-200">
                                {finding.explanation}
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`rounded-full px-2 py-1 text-xs ${severityBadgeClass(
                                  finding.severity
                                )}`}
                              >
                                {finding.severity}
                              </span>
                              <span className="rounded-full bg-white/5 px-2 py-1 text-xs uppercase tracking-wide text-slate-300">
                                {formatSourceLabel(finding.source)}
                              </span>
                              {finding.ruleId ? (
                                <span className="rounded-full bg-white/5 px-2 py-1 text-xs text-slate-300">
                                  {formatRuleLabel(finding.ruleId)}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-5 rounded-[1.25rem] border border-dashed border-white/10 p-6 text-sm text-slate-400">
                No findings were stored for this run.
              </div>
            )}
          </section>

          <section className="observer-panel rounded-[1.75rem] p-6">
            <div className="observer-kicker">What GitHub did not show</div>
            <h2 className="mt-3 text-xl font-semibold text-white">Suppressed and skipped</h2>
            <p className="mt-2 text-sm text-slate-400">
              Observer filters low-value noise and keeps the failed anchor attempts here for triage.
            </p>

            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <div className="rounded-[1.35rem] border border-white/10 bg-black/20 p-5">
                <div className="text-sm font-medium text-white">Suppressed candidates</div>
                <div className="mt-1 text-sm text-slate-400">
                  {suppressedCandidates.length} candidate
                  {suppressedCandidates.length === 1 ? "" : "s"} held back to keep the PR readable.
                </div>

                <div className="mt-4 space-y-3">
                  {suppressedCandidates.length > 0 ? (
                    suppressedCandidates.slice(0, 6).map((candidate) => (
                      <div
                        key={candidate.id}
                        className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"
                      >
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                          <span className="rounded-full bg-white/5 px-2 py-1">
                            {candidate.path}
                          </span>
                          <span className="rounded-full bg-white/5 px-2 py-1">
                            line {candidate.lineStart}
                          </span>
                          <span className="rounded-full bg-white/5 px-2 py-1">
                            {candidate.reason ?? "suppressed"}
                          </span>
                        </div>
                        <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-200">
                          {candidate.body}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-white/10 p-5 text-sm text-slate-500">
                      No suppressed candidates in this run.
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-[1.35rem] border border-white/10 bg-black/20 p-5">
                <div className="text-sm font-medium text-white">Skipped inline anchors</div>
                <div className="mt-1 text-sm text-slate-400">
                  {skippedPreviews.length} preview
                  {skippedPreviews.length === 1 ? "" : "s"} could not be attached to the patch.
                </div>

                <div className="mt-4 space-y-3">
                  {skippedPreviews.length > 0 ? (
                    skippedPreviews.slice(0, 6).map((preview) => (
                      <div
                        key={preview.id}
                        className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"
                      >
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                          <span className="rounded-full bg-white/5 px-2 py-1">{preview.path}</span>
                          <span className="rounded-full bg-white/5 px-2 py-1">
                            {preview.skipReason ?? "unknown"}
                          </span>
                        </div>
                        <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-200">
                          {preview.body}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-white/10 p-5 text-sm text-slate-500">
                      No skipped anchors in this run.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          <details className="observer-panel rounded-[1.75rem] p-6">
            <summary className="cursor-pointer list-none text-lg font-semibold text-white">
              Technical details
            </summary>
            <p className="mt-2 text-sm text-slate-400">
              Lower-signal implementation details, payload metadata, and debug context.
            </p>

            <div className="mt-5 grid gap-5 xl:grid-cols-2">
              <div className="rounded-[1.35rem] border border-white/10 bg-black/20 p-5">
                <div className="text-sm font-medium text-white">Changed files</div>
                <div className="mt-4 space-y-3">
                  {run.files.map((file) => (
                    <div
                      key={file.id}
                      className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm text-slate-300"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className="font-medium text-white">{file.path}</span>
                        <span className="text-xs text-slate-400">
                          +{file.additions} / -{file.deletions}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{file.status}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[1.35rem] border border-white/10 bg-black/20 p-5">
                <div className="text-sm font-medium text-white">Run internals</div>
                <div className="mt-4 space-y-3 text-sm text-slate-300">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                      Publication candidates
                    </div>
                    <div className="mt-2">
                      {publishedCandidates.length} published · {blockingCandidates.length} blocking
                      · {remainingFindings.length} additional findings
                    </div>
                  </div>

                  {run.showVerboseLlmDebug ? (
                    <>
                      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                          LLM bundles
                        </div>
                        <pre className="mt-3 overflow-x-auto text-xs leading-6 whitespace-pre-wrap text-slate-300">
                          {JSON.stringify(llmBundles, null, 2)}
                        </pre>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                          LLM parse errors
                        </div>
                        <pre className="mt-3 overflow-x-auto text-xs leading-6 whitespace-pre-wrap text-slate-300">
                          {JSON.stringify(llmParseErrors, null, 2)}
                        </pre>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-white/10 p-5 text-sm text-slate-500">
                      Verbose LLM diagnostics are hidden because <code>DEBUG_LLM_UI</code> is off.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </details>
        </div>

        <aside className="space-y-6">
          <section className="observer-panel rounded-[1.75rem] p-6">
            <div className="observer-kicker">Run state</div>
            <div className="mt-4 space-y-4 text-sm text-slate-300">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  Latest GitHub review
                </div>
                <div className="mt-2 text-lg font-semibold text-white">
                  {run.lastPublication
                    ? formatReviewEventLabel(run.lastPublication.reviewEvent)
                    : "No GitHub review yet"}
                </div>
                <div className="mt-1 text-sm text-slate-400">
                  {run.lastPublication
                    ? `${run.lastPublication.commentsCount} inline comments · ${run.lastPublication.status}`
                    : "Observer has not published for this run yet."}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  Timeline
                </div>
                <div className="mt-2 space-y-2 text-sm text-slate-300">
                  <div>Created {formatDateTime(run.createdAt)}</div>
                  <div>Updated {formatDateTime(run.updatedAt)}</div>
                  {run.startedAt ? <div>Started {formatDateTime(run.startedAt)}</div> : null}
                  {run.completedAt ? (
                    <div>Completed {formatDateTime(run.completedAt)}</div>
                  ) : null}
                </div>
              </div>
            </div>
          </section>

          <section className="observer-panel rounded-[1.75rem] p-6">
            <div className="observer-kicker">Publication history</div>
            <div className="mt-4 space-y-3">
              {run.publications.length > 0 ? (
                run.publications.map((publication) => (
                  <div
                    key={publication.id}
                    className="rounded-2xl border border-white/10 bg-black/20 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium text-white">
                        {formatReviewEventLabel(publication.reviewEvent)}
                      </div>
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${publicationStatusClass(
                          publication.status
                        )}`}
                      >
                        {publication.status}
                      </span>
                    </div>
                    <div className="mt-2 text-xs text-slate-400">
                      {formatDateTime(publication.createdAt)}
                    </div>
                    <div className="mt-2 text-sm text-slate-300">
                      {publication.commentsCount} inline comment
                      {publication.commentsCount === 1 ? "" : "s"}
                    </div>
                    {publication.error ? (
                      <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                        {publication.error}
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 p-5 text-sm text-slate-500">
                  No publication history yet.
                </div>
              )}
            </div>
          </section>

          {canManuallyPublish ? (
            <section className="observer-panel rounded-[1.75rem] p-6">
              <div className="observer-kicker">Fallback action</div>
              <div className="mt-3 text-sm leading-7 text-slate-300">
                Auto publish is the default path. Keep this as a manual recovery button when you are
                debugging delivery or retriggering a failed publish.
              </div>
              <button
                type="button"
                onClick={() => {
                  void handleManualPublish();
                }}
                disabled={manualPublishState.status === "pending"}
                className="mt-5 w-full rounded-2xl border border-sky-400/20 bg-sky-500/10 px-4 py-3 text-sm font-medium text-sky-100 transition hover:border-sky-300/30 hover:bg-sky-500/14 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {manualPublishState.status === "pending"
                  ? "Publishing..."
                  : run.publishState === "failed"
                    ? "Retry GitHub review"
                    : "Publish GitHub review"}
              </button>
              {manualPublishState.message ? (
                <div
                  className={`mt-4 rounded-2xl px-3 py-2 text-xs ${
                    manualPublishState.status === "error"
                      ? "border border-red-500/20 bg-red-500/10 text-red-200"
                      : "border border-white/10 bg-white/5 text-slate-300"
                  }`}
                >
                  {manualPublishState.message}
                </div>
              ) : null}
            </section>
          ) : null}
        </aside>
      </div>
    </ObserverShell>
  );
}
