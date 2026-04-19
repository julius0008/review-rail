"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { DashboardRunsSnapshot } from "@/lib/review-run-types";
import {
  formatDateTime,
  formatReviewEventLabel,
  getDashboardRunIds,
  getDisplayFindingTitle,
  getReviewRunPath,
  getTopFindings,
  LlmPill,
  PublishPill,
  ReviewOutcomePill,
  severityBadgeClass,
  StatusPill,
} from "./review-ui";
import { ObserverShell } from "./observer-shell";
import {
  type LiveConnectionState,
  useLiveSnapshot,
} from "./use-live-snapshot";

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
  initialSnapshot: DashboardRunsSnapshot;
};

export function DashboardLive({ initialSnapshot }: Props) {
  const router = useRouter();
  const { data, connectionState } = useLiveSnapshot({
    initialData: initialSnapshot,
    fetchUrl: "/api/review-runs",
    streamUrl: "/api/review-runs/stream",
    pollIntervalMs: 5000,
  });
  const [highlightedRunIds, setHighlightedRunIds] = useState<string[]>([]);
  const previousRunIds = useRef(getDashboardRunIds(initialSnapshot.history));

  useEffect(() => {
    const currentIds = getDashboardRunIds(data.history);
    const previousIds = new Set(previousRunIds.current);
    const newIds = currentIds.filter((runId) => !previousIds.has(runId));

    if (newIds.length > 0) {
      setHighlightedRunIds((existing) => [...new Set([...existing, ...newIds])]);

      const timeout = window.setTimeout(() => {
        setHighlightedRunIds((existing) =>
          existing.filter((runId) => !newIds.includes(runId))
        );
      }, 5000);

      previousRunIds.current = currentIds;
      return () => window.clearTimeout(timeout);
    }

    previousRunIds.current = currentIds;
  }, [data.history]);

  const currentRun = data.currentRun;
  const topFindings = currentRun ? getTopFindings(currentRun.findings) : [];
  const suppressedCandidates = currentRun
    ? currentRun.commentCandidates.filter((candidate) => !candidate.isPublishable).length
    : 0;
  const blockingFindingsCount = currentRun
    ? currentRun.findings.filter(
        (finding) =>
          finding.publishReason === "publishable_high_signal" ||
          finding.publishReason === "publishable_llm_high_confidence"
      ).length
    : 0;
  const invalidPreviews = currentRun
    ? currentRun.commentPreviews.filter((preview) => !preview.isValid).length
    : 0;
  const publishedComments = currentRun?.lastPublication?.commentsCount ?? 0;

  return (
    <ObserverShell
      eyebrow="Observer workspace"
      title="Current review"
      description={
        <>
          Start in GitHub for the routine conversation. Open Observer when you need the merge
          decision, the exact publication context, and the change-tracking behind the latest run.
        </>
      }
      connectionState={connectionState}
      headerActions={
        <span
          className={`rounded-full px-3 py-2 text-xs font-medium ${liveIndicatorClass(
            connectionState
          )}`}
        >
          {liveIndicatorLabel(connectionState)}
        </span>
      }
    >
      {currentRun ? (
        <>
          <section className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_380px]">
            <div className="observer-panel rounded-[1.75rem] p-6 sm:p-7">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                      {currentRun.repoId}
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                      PR #{currentRun.prNumber}
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono">
                      {currentRun.headSha.slice(0, 8)}
                    </span>
                  </div>

                  <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white">
                    {currentRun.title ?? "Current pull request"}
                  </h2>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <ReviewOutcomePill outcome={currentRun.reviewOutcome} />
                    <StatusPill status={currentRun.status} />
                    <PublishPill state={currentRun.publishState} />
                    <LlmPill status={currentRun.llmStatus} />
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  <a
                    href={currentRun.pullRequestUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100 hover:border-white/20 hover:bg-white/8"
                  >
                    Open PR
                  </a>
                  <Link
                    href={getReviewRunPath(currentRun.id)}
                    className="rounded-2xl border border-sky-400/20 bg-sky-500/10 px-4 py-2 text-sm font-medium text-sky-100 hover:border-sky-300/30 hover:bg-sky-500/14"
                  >
                    Open full run
                  </Link>
                </div>
              </div>

              <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_300px]">
                <div className="rounded-[1.5rem] border border-white/10 bg-black/25 p-5">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    Merge decision
                  </div>
                  <div className="mt-3 text-xl font-semibold text-white">
                    {currentRun.reviewOutcome === "blocking"
                      ? "Observer is blocking merge"
                      : currentRun.reviewOutcome === "comment_only"
                        ? "Observer has follow-up notes"
                        : currentRun.reviewOutcome === "clean"
                          ? "Observer is clear to merge"
                          : currentRun.reviewOutcome === "failed"
                            ? "Observer could not finish this run"
                            : "Observer is still processing this run"}
                  </div>
                  <p className="mt-3 text-sm leading-7 text-slate-300">
                    {currentRun.mergeBlockReason ??
                      (currentRun.reviewOutcome === "clean"
                        ? "No merge-blocking findings remain in the latest run."
                        : currentRun.reviewOutcome === "comment_only"
                          ? "The latest review contains useful follow-up items, but they are not strong enough to block the pull request."
                          : currentRun.error ??
                            "The run is still in progress, so Observer has not made its final merge recommendation yet.")}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-400">
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                      {blockingFindingsCount} blocking finding
                      {blockingFindingsCount === 1 ? "" : "s"}
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                      {publishedComments} published comment
                      {publishedComments === 1 ? "" : "s"}
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                      Updated {formatDateTime(currentRun.updatedAt)}
                    </span>
                  </div>
                </div>

                <div className="rounded-[1.5rem] border border-white/10 bg-black/25 p-5">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    What to do next
                  </div>
                  <div className="mt-3 space-y-3 text-sm leading-7 text-slate-300">
                    {currentRun.reviewOutcome === "blocking" ? (
                      <>
                        <p>Fix the highest-priority findings below first.</p>
                        <p>Push a new commit and Observer will rerun automatically.</p>
                      </>
                    ) : currentRun.reviewOutcome === "comment_only" ? (
                      <>
                        <p>Use the GitHub comments for quick cleanup.</p>
                        <p>Open the full run when you need suppressed findings or anchor failures.</p>
                      </>
                    ) : currentRun.reviewOutcome === "clean" ? (
                      <>
                        <p>The latest run is clean from Observer’s perspective.</p>
                        <p>Only open the full run if you want the publication history or comparison trail.</p>
                      </>
                    ) : (
                      <>
                        <p>Wait for the pipeline to finish, then refresh if the state looks stale.</p>
                        <p>Open the full run if you need the detailed job timeline.</p>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {currentRun.delta ? (
                <div className="mt-6 rounded-[1.5rem] border border-white/10 bg-black/20 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-white">What changed since the last run</div>
                      <div className="mt-1 text-sm text-slate-400">
                        This is the quickest way to tell whether the latest push actually improved
                        the pull request.
                      </div>
                    </div>
                    <div className="grid min-w-full gap-3 sm:min-w-[360px] sm:grid-cols-3">
                      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-emerald-200/80">
                          Resolved
                        </div>
                        <div className="mt-2 text-2xl font-semibold text-white">
                          {currentRun.delta.resolvedFindings}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-amber-100/80">
                          New
                        </div>
                        <div className="mt-2 text-2xl font-semibold text-white">
                          {currentRun.delta.newFindings}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                          Persistent
                        </div>
                        <div className="mt-2 text-2xl font-semibold text-white">
                          {currentRun.delta.persistentFindings}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="mt-6 rounded-[1.5rem] border border-white/10 bg-black/20 p-5">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-white">What to look at first</div>
                    <div className="mt-1 text-sm text-slate-400">
                      The short list worth reading before you open the full run details.
                    </div>
                  </div>
                </div>

                {topFindings.length > 0 ? (
                  <div className="mt-4 space-y-3">
                    {topFindings.map((finding) => (
                      <div
                        key={finding.id}
                        className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-1 text-xs ${severityBadgeClass(
                              finding.severity
                            )}`}
                          >
                            {finding.severity}
                          </span>
                          <span className="rounded-full bg-white/5 px-2 py-1 text-xs text-slate-300">
                            {finding.path}
                          </span>
                          <span className="rounded-full bg-white/5 px-2 py-1 text-xs text-slate-300">
                            line {finding.lineStart}
                          </span>
                        </div>
                        <div className="mt-3 text-sm font-semibold text-white">
                          {getDisplayFindingTitle(
                            finding.title,
                            finding.ruleId,
                            finding.explanation
                          )}
                        </div>
                        <div className="mt-1 text-sm text-slate-300">{finding.explanation}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-dashed border-white/10 p-6 text-sm text-slate-400">
                    No findings in the latest run.
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-6">
              <div className="observer-panel rounded-[1.75rem] p-6">
                <div className="observer-kicker">Published review</div>
                {currentRun.lastPublication ? (
                  <>
                    <div className="mt-4 text-2xl font-semibold text-white">
                      {formatReviewEventLabel(currentRun.lastPublication.reviewEvent)}
                    </div>
                    <div className="mt-2 text-sm text-slate-300">
                      {currentRun.lastPublication.commentsCount} inline comment
                      {currentRun.lastPublication.commentsCount === 1 ? "" : "s"} ·{" "}
                      {currentRun.lastPublication.status}
                    </div>
                    <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="space-y-3 text-sm text-slate-300">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-slate-400">Last published</span>
                          <span>{formatDateTime(currentRun.lastPublication.createdAt)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-slate-400">GitHub review</span>
                          <span>{formatReviewEventLabel(currentRun.lastPublication.reviewEvent)}</span>
                        </div>
                      </div>
                      {currentRun.lastPublication.error ? (
                        <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                          {currentRun.lastPublication.error}
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <div className="mt-4 text-sm leading-7 text-slate-400">
                    Observer has not posted a GitHub review yet. Clean runs can stay quiet unless
                    they need to clear an earlier blocking review.
                  </div>
                )}
              </div>

              <div className="observer-panel rounded-[1.75rem] p-6">
                <div className="observer-kicker">Observer context</div>
                <div className="mt-4 space-y-4 text-sm text-slate-300">
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-400">Published to GitHub</span>
                      <span className="font-medium text-white">{publishedComments}</span>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-400">Suppressed for noise control</span>
                      <span className="font-medium text-white">{suppressedCandidates}</span>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-400">Anchors GitHub could not place</span>
                      <span className="font-medium text-white">{invalidPreviews}</span>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-dashed border-white/10 p-4 text-slate-400">
                    Open the full run when the PR thread alone is not enough to explain the
                    verdict, skipped comments, or run-to-run trend.
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section id="history" className="mt-6 observer-panel rounded-[1.75rem] p-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="observer-kicker">Recent history</div>
                <h3 className="mt-3 text-xl font-semibold text-white">Past runs at a glance</h3>
                <div className="mt-1 text-sm text-slate-400">
                  Enough history to see the recent story without turning the homepage into an
                  operations dashboard.
                </div>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {data.history.slice(0, 10).map((run) => {
                const runPath = getReviewRunPath(run.id);
                const highlighted = highlightedRunIds.includes(run.id);

                return (
                  <Link
                    key={run.id}
                    href={runPath}
                    prefetch={false}
                    onMouseEnter={() => router.prefetch(runPath)}
                    onFocus={() => router.prefetch(runPath)}
                    className={`block rounded-[1.4rem] border border-white/10 bg-white/[0.04] p-4 ${
                      highlighted ? "run-row-highlight" : ""
                    }`}
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                          <span className="rounded-full bg-white/5 px-2 py-1">{run.repoId}</span>
                          <span className="rounded-full bg-white/5 px-2 py-1">PR #{run.prNumber}</span>
                          <span className="rounded-full bg-white/5 px-2 py-1 font-mono">
                            {run.headSha.slice(0, 8)}
                          </span>
                        </div>
                        <div className="mt-3 text-lg font-semibold text-white">
                          {run.title ?? `Run ${run.id.slice(0, 8)}`}
                        </div>
                        <div className="mt-2 text-sm text-slate-300">
                          {run.mergeBlockReason ??
                            (run.reviewOutcome === "comment_only"
                              ? "Follow-up items were published without blocking merge."
                              : run.reviewOutcome === "clean"
                                ? "No blocking findings remained in this run."
                                : run.reviewOutcome === "failed"
                                  ? "The run failed before Observer could produce a stable review."
                                  : "Observer is still working through this run.")}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <ReviewOutcomePill outcome={run.reviewOutcome} />
                        <StatusPill status={run.status} />
                        <PublishPill state={run.publishState} />
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
                      <div className="flex flex-wrap gap-3 text-sm text-slate-400">
                        <span>{run.counts.blockingFindings} blocking</span>
                        <span>{run.counts.findings} total findings</span>
                        <span>{run.counts.publishedComments} published comments</span>
                        <span>Updated {formatDateTime(run.updatedAt)}</span>
                      </div>

                      <div className="text-sm text-slate-400">
                        {run.lastPublication
                          ? `${formatReviewEventLabel(run.lastPublication.reviewEvent)} · ${run.lastPublication.status}`
                          : "No GitHub review posted"}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        </>
      ) : (
        <section className="observer-panel rounded-[1.75rem] p-10 text-center">
          <div className="mx-auto max-w-2xl">
            <div className="observer-kicker">Waiting for signal</div>
            <h2 className="mt-4 text-3xl font-semibold text-white">No active review yet</h2>
            <p className="mt-4 text-sm leading-7 text-slate-300">
              Open or update a pull request in a connected repository and Observer will create a
              run automatically, publish the review back to GitHub, and keep the deeper triage
              context here.
            </p>
          </div>
        </section>
      )}
    </ObserverShell>
  );
}
