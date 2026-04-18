"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { DashboardRunsSnapshot } from "@/lib/review-run-types";
import {
  getDashboardRunIds,
  getReviewRunPath,
  getStatusStepClass,
  formatDateTime,
  LlmPill,
  PublishPill,
  StatusPill,
} from "./review-ui";
import {
  type LiveConnectionState,
  useLiveSnapshot,
} from "./use-live-snapshot";

function liveIndicatorClass(state: LiveConnectionState) {
  if (state === "live") return "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/30";
  if (state === "reconnecting") return "bg-amber-500/15 text-amber-200 ring-1 ring-amber-400/30";
  if (state === "polling") return "bg-blue-500/15 text-blue-200 ring-1 ring-blue-400/30";
  return "bg-white/8 text-zinc-300 ring-1 ring-white/10";
}

function liveIndicatorLabel(state: LiveConnectionState) {
  if (state === "live") return "Live";
  if (state === "reconnecting") return "Reconnecting";
  if (state === "polling") return "Polling fallback";
  return "Connecting";
}

type Props = {
  initialSnapshot: DashboardRunsSnapshot;
};

export function DashboardLive({ initialSnapshot }: Props) {
  const { data, connectionState } = useLiveSnapshot({
    initialData: initialSnapshot,
    fetchUrl: "/api/review-runs",
    streamUrl: "/api/review-runs/stream",
    pollIntervalMs: 5000,
  });
  const [highlightedRunIds, setHighlightedRunIds] = useState<string[]>([]);
  const previousRunIds = useRef(getDashboardRunIds(initialSnapshot.runs));

  useEffect(() => {
    const currentIds = getDashboardRunIds(data.runs);
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
  }, [data.runs]);

  const { latestRun, runs, summary } = data;

  return (
    <main className="min-h-screen text-zinc-100">
      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="glass-panel relative overflow-hidden rounded-[2rem] px-7 py-8 sm:px-10 sm:py-10">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="mb-3 text-xs uppercase tracking-[0.32em] text-cyan-200/80">
                Review Rail
              </p>
              <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                Deterministic pull request review, with optional local-first LLM augmentation.
              </h1>
              <p className="mt-5 max-w-3xl text-base leading-7 text-slate-300">
                GitHub App webhooks create review runs, the worker snapshots changed files, runs
                Biome and Semgrep first, and then optionally enriches only the highest-signal hunks
                with Ollama. The baseline pipeline stays healthy even when LLM review is disabled.
              </p>
            </div>

            <div
              className={`inline-flex w-fit items-center rounded-full px-3 py-2 text-xs font-medium ${liveIndicatorClass(
                connectionState
              )}`}
            >
              {liveIndicatorLabel(connectionState)}
            </div>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-5">
              <p className="text-sm text-slate-300">Tracked runs</p>
              <p className="mt-2 text-3xl font-semibold">{summary.totalRuns}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-5">
              <p className="text-sm text-slate-300">Publish-ready</p>
              <p className="mt-2 text-3xl font-semibold">{summary.publishReadyRuns}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-5">
              <p className="text-sm text-slate-300">LLM-augmented</p>
              <p className="mt-2 text-3xl font-semibold">{summary.llmAugmentedRuns}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-5">
              <p className="text-sm text-slate-300">Failed runs</p>
              <p className="mt-2 text-3xl font-semibold">{summary.failedRuns}</p>
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-[1.5fr_1fr]">
          <div className="glass-panel rounded-[1.75rem] p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-white">Pipeline posture</h2>
                <p className="mt-1 text-sm leading-6 text-slate-300">
                  {summary.totalRuns === 0
                    ? "No review runs yet. Open or update a pull request to start the pipeline."
                    : `Processed ${summary.totalRuns} runs, captured ${summary.totalFindings} findings, and completed ${summary.completedRuns} full review cycles so far.`}
                </p>
              </div>
              {latestRun && <StatusPill status={latestRun.status} />}
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              {["queued", "fetching", "analyzing", "postprocessing", "llm_pending", "publish_ready", "completed"].map((step) => (
                <div
                  key={step}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium uppercase tracking-wide ${getStatusStepClass(
                    latestRun?.status ?? "queued",
                    step
                  )}`}
                >
                  {step}
                </div>
              ))}
            </div>
          </div>

          <div className="glass-panel rounded-[1.75rem] p-6">
            <h2 className="text-xl font-semibold text-white">Latest run</h2>
            {latestRun ? (
              <>
                <p className="mt-1 text-sm text-slate-300">
                  {latestRun.repoId} PR #{latestRun.prNumber}
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <StatusPill status={latestRun.status} />
                  <PublishPill state={latestRun.publishState} />
                  <LlmPill status={latestRun.llmStatus} />
                </div>
                <p className="mt-5 text-sm text-slate-300">
                  Created {formatDateTime(latestRun.createdAt)} with {latestRun.counts.findings} stored findings.
                </p>
              </>
            ) : (
              <p className="mt-3 text-sm text-slate-300">No runs have been captured yet.</p>
            )}
          </div>
        </div>

        <div className="mt-8 glass-panel rounded-[1.75rem] p-6">
          <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white">Recent review runs</h2>
              <p className="mt-1 text-sm text-slate-300">
                Inspect deterministic findings, optional Ollama augmentation, review payload previews, and publication history.
              </p>
            </div>
            <div className="text-xs uppercase tracking-[0.22em] text-slate-400">
              Queue-backed PR review pipeline
            </div>
          </div>

          <div className="space-y-3">
            {runs.map((run) => (
              <Link
                key={run.id}
                href={getReviewRunPath(run.id)}
                className={`block rounded-3xl border border-white/10 bg-slate-950/60 p-5 transition hover:border-cyan-300/30 hover:bg-slate-950/80 ${
                  highlightedRunIds.includes(run.id) ? "run-row-highlight" : ""
                }`}
              >
                <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-medium text-white">{run.repoId}</div>
                      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] uppercase tracking-wide text-slate-300">
                        PR #{run.prNumber}
                      </span>
                    </div>

                    <div className="mt-1 text-sm text-slate-400">
                      Head {run.headSha.slice(0, 8)} · {run.counts.files} files · {run.counts.findings} findings
                    </div>

                    {run.title && (
                      <div className="mt-3 max-w-2xl text-sm text-slate-300">
                        {run.title}
                      </div>
                    )}

                    <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                      <span>{run.counts.commentCandidates} draft comments</span>
                      <span>{run.counts.commentPreviews} payload previews</span>
                      <span>Created {formatDateTime(run.createdAt)}</span>
                    </div>

                    {run.error && (
                      <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                        {run.error}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    <StatusPill status={run.status} />
                    <PublishPill state={run.publishState} />
                    <LlmPill status={run.llmStatus} />
                  </div>
                </div>
              </Link>
            ))}

            {runs.length === 0 && (
              <div className="rounded-3xl border border-dashed border-white/10 p-10 text-center text-slate-400">
                No review runs yet.
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
