"use client";

import { useRouter } from "next/navigation";
import type { ReviewRunDetailDto } from "@/lib/review-run-types";
import {
  buildFindingsByPath,
  buildSummarySentence,
  findingCardClass,
  formatDateTime,
  formatRuleLabel,
  formatSourceLabel,
  getDisplayFindingTitle,
  getTopFindings,
  llmStatusClass,
  publicationStatusClass,
  publishStateClass,
  readJsonArray,
  readJsonObject,
  severityBadgeClass,
  StatusPill,
} from "./review-ui";
import {
  type LiveConnectionState,
  useLiveSnapshot,
} from "./use-live-snapshot";

const terminalStatuses = new Set(["publish_ready", "completed", "failed", "stale"]);

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

  const severityCounts = {
    high: run.findings.filter((finding) => finding.severity === "high").length,
    medium: run.findings.filter((finding) => finding.severity === "medium").length,
    low: run.findings.filter((finding) => finding.severity === "low").length,
  };

  const sourceCounts = {
    biome: run.findings.filter((finding) => finding.source === "biome").length,
    semgrep: run.findings.filter((finding) => finding.source === "semgrep").length,
    ollama: run.findings.filter((finding) => finding.source === "ollama").length,
  };

  const findingsByPath = buildFindingsByPath(run.findings);
  const topFindings = getTopFindings(run.findings);
  const publishableCandidates = run.commentCandidates.filter(
    (candidate) => candidate.isPublishable
  );
  const suppressedCandidates = run.commentCandidates.filter(
    (candidate) => !candidate.isPublishable
  );
  const summary = buildSummarySentence(run.findings);
  const validPreviews = run.commentPreviews.filter((preview) => preview.isValid);
  const skippedPreviews = run.commentPreviews.filter((preview) => !preview.isValid);
  const alreadyPublished = run.publishState === "published";
  const llmMetadata = readJsonObject(run.llmMetadata);
  const llmParseErrors = readJsonArray(llmMetadata?.parseErrors);
  const llmBundles = readJsonArray(llmMetadata?.bundles);

  return (
    <main className="min-h-screen text-zinc-100">
      <section className="mx-auto max-w-6xl px-6 py-14">
        <div className="glass-panel rounded-[2rem] px-7 py-8">
          <div className="mb-8 flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <button
                type="button"
                onClick={() => {
                  if (window.history.length > 1) {
                    router.back();
                    return;
                  }

                  router.push("/");
                }}
                className="text-sm text-zinc-400 transition hover:text-zinc-200"
              >
                ← Back to dashboard
              </button>

              <p className="mt-4 text-sm uppercase tracking-[0.24em] text-zinc-400">
                Review Run
              </p>

              <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                {run.repoId} · PR #{run.prNumber}
              </h1>

              <p className="mt-2 max-w-3xl text-zinc-400">
                {run.title ?? "Untitled pull request"}
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-zinc-500">
                <span>Created {formatDateTime(run.createdAt)}</span>
                <span>Updated {formatDateTime(run.updatedAt)}</span>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
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

                {alreadyPublished ? (
                  <span
                    className={`rounded-full px-3 py-2 text-xs font-medium ${publicationStatusClass(
                      "published"
                    )}`}
                  >
                    Published to GitHub
                  </span>
                ) : (
                  <form action={`/api/reviews/${run.id}/publish`} method="post">
                    <button className="rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-zinc-900 transition hover:bg-zinc-200">
                      Publish GitHub review
                    </button>
                  </form>
                )}
              </div>
            </div>

            <StatusPill status={run.status} />
          </div>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-4">
          <div className="glass-panel rounded-2xl p-5">
            <p className="text-sm text-zinc-400">Files changed</p>
            <p className="mt-2 text-2xl font-semibold">{run.files.length}</p>
          </div>

          <div className="glass-panel rounded-2xl p-5">
            <p className="text-sm text-zinc-400">Findings</p>
            <p className="mt-2 text-2xl font-semibold">{run.findings.length}</p>
          </div>

          <div className="glass-panel rounded-2xl p-5">
            <p className="text-sm text-zinc-400">Publish state</p>
            <p className="mt-2 text-sm font-medium capitalize">{run.publishState}</p>
          </div>

          <div className="glass-panel rounded-2xl p-5">
            <p className="text-sm text-zinc-400">Base SHA</p>
            <p className="mt-2 text-sm font-medium">{run.baseSha?.slice(0, 12) ?? "—"}</p>
          </div>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-[1.35fr_1fr]">
          <div className="glass-panel rounded-3xl p-6">
            <h2 className="text-xl font-semibold">Review posture</h2>
            <p className="mt-3 text-sm leading-7 text-zinc-300">{summary}</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-wide text-zinc-400">Deterministic core</p>
                <p className="mt-2 text-2xl font-semibold">
                  {sourceCounts.biome + sourceCounts.semgrep}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-wide text-zinc-400">LLM findings</p>
                <p className="mt-2 text-2xl font-semibold">{sourceCounts.ollama}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-wide text-zinc-400">Valid payloads</p>
                <p className="mt-2 text-2xl font-semibold">{validPreviews.length}</p>
              </div>
            </div>
            {run.llmSummary && (
              <div className="mt-5 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4 text-sm text-cyan-50">
                {run.llmSummary}
              </div>
            )}
            {llmMetadata && (
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs uppercase tracking-wide text-zinc-400">LLM diagnostics</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <div>
                    <div className="text-xs text-zinc-500">Bundles reviewed</div>
                    <div className="mt-1 text-lg font-semibold">
                      {String(llmMetadata.bundleCount ?? 0)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500">Raw / parsed</div>
                    <div className="mt-1 text-lg font-semibold">
                      {String(llmMetadata.rawFindingCount ?? 0)} /{" "}
                      {String(llmMetadata.parsedFindingCount ?? 0)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500">Accepted</div>
                    <div className="mt-1 text-lg font-semibold">
                      {String(llmMetadata.acceptedFindingCount ?? 0)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500">Low confidence</div>
                    <div className="mt-1 text-sm font-medium">
                      {String(llmMetadata.belowConfidenceCount ?? 0)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500">Overlapping</div>
                    <div className="mt-1 text-sm font-medium">
                      {String(llmMetadata.overlappingCount ?? 0)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500">Invalid shape</div>
                    <div className="mt-1 text-sm font-medium">
                      {String(llmMetadata.invalidShapeCount ?? 0)}
                    </div>
                  </div>
                </div>
                {run.showVerboseLlmDebug && llmParseErrors.length > 0 && (
                  <div className="mt-4">
                    <div className="text-xs uppercase tracking-wide text-zinc-500">Parse failures</div>
                    <div className="mt-2 space-y-2">
                      {llmParseErrors.slice(0, 4).map((error, index) => (
                        <div
                          key={index}
                          className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-50"
                        >
                          <div>
                            Finding #{String(error.index ?? index)}:{" "}
                            {String(error.message ?? "Invalid shape")}
                          </div>
                          <div className="mt-1 text-xs text-amber-100/80">
                            Fields:{" "}
                            {Array.isArray(error.fields)
                              ? error.fields.join(", ")
                              : "unknown"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {run.showVerboseLlmDebug && llmBundles.length > 0 && (
                  <div className="mt-4">
                    <div className="text-xs uppercase tracking-wide text-zinc-500">Bundle responses</div>
                    <div className="mt-2 space-y-3">
                      {llmBundles.slice(0, 3).map((bundle, index) => (
                        <details
                          key={index}
                          className="rounded-xl border border-white/10 bg-black/20 p-3"
                        >
                          <summary className="cursor-pointer text-sm text-zinc-200">
                            {String(bundle.path ?? `bundle-${index}`)} · raw{" "}
                            {String(bundle.rawFindingCount ?? 0)} / parsed{" "}
                            {String(bundle.parsedFindingCount ?? 0)} / accepted{" "}
                            {String(bundle.acceptedFindingCount ?? 0)}
                          </summary>
                          <pre className="mt-3 overflow-x-auto rounded-xl bg-black/40 p-4 text-xs text-zinc-300 whitespace-pre-wrap">
                            {String(bundle.rawResponsePreview ?? "No response preview available.")}
                          </pre>
                        </details>
                      ))}
                    </div>
                  </div>
                )}
                {!run.showVerboseLlmDebug &&
                  (llmParseErrors.length > 0 || llmBundles.length > 0) && (
                    <p className="mt-4 text-xs text-zinc-500">
                      Verbose LLM debug details are hidden. Set{" "}
                      <code>DEBUG_LLM_UI=true</code> to inspect parse failures and raw
                      bundle responses locally.
                    </p>
                  )}
              </div>
            )}
            {run.llmError && (
              <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-100">
                LLM augmentation failed safely: {run.llmError}
              </div>
            )}
          </div>

          <div className="glass-panel rounded-3xl p-6">
            <h2 className="text-xl font-semibold">Severity mix</h2>
            <div className="mt-5 grid gap-3">
              <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4">
                <div className="text-xs uppercase tracking-wide text-red-200">High</div>
                <div className="mt-2 text-2xl font-semibold">{severityCounts.high}</div>
              </div>
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                <div className="text-xs uppercase tracking-wide text-amber-200">Medium</div>
                <div className="mt-2 text-2xl font-semibold">{severityCounts.medium}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs uppercase tracking-wide text-zinc-300">Low</div>
                <div className="mt-2 text-2xl font-semibold">{severityCounts.low}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-6">
          <div className="mb-5">
            <h2 className="text-xl font-semibold">Draft review comments</h2>
            <p className="mt-1 text-sm text-zinc-400">
              High-signal findings prepared as inline comment candidates. Deterministic findings lead; LLM findings are additive and stricter about confidence.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <p className="text-sm text-zinc-400">Publishable</p>
              <p className="mt-2 text-2xl font-semibold">{publishableCandidates.length}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <p className="text-sm text-zinc-400">Summary only</p>
              <p className="mt-2 text-2xl font-semibold">{suppressedCandidates.length}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <p className="text-sm text-zinc-400">Review summary</p>
              <p className="mt-2 text-sm text-zinc-300">{run.summary ?? "No summary generated."}</p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              {publishableCandidates.length > 0 ? (
                publishableCandidates.slice(0, 5).map((candidate) => (
                  <div
                    key={candidate.id}
                    className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                      <span className="rounded-full bg-white/5 px-2 py-1">{candidate.path}</span>
                      <span className="rounded-full bg-white/5 px-2 py-1">line {candidate.lineStart}</span>
                      <span className="rounded-full bg-white/5 px-2 py-1">{candidate.source}</span>
                      <span className="rounded-full bg-white/5 px-2 py-1">{candidate.reason}</span>
                    </div>

                    <div className="mt-3 whitespace-pre-wrap text-sm text-zinc-200">
                      {candidate.body}
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-zinc-400">
                  No publishable inline comment candidates yet.
                </div>
              )}
            </div>
            <div>
              <h3 className="text-sm font-medium text-zinc-300">Summary-only candidates</h3>
              <div className="mt-3 space-y-3">
                {suppressedCandidates.length > 0 ? (
                  suppressedCandidates.slice(0, 5).map((candidate) => (
                    <div
                      key={candidate.id}
                      className="rounded-xl border border-white/10 bg-white/5 p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                        <span className="rounded-full bg-white/5 px-2 py-1">{candidate.path}</span>
                        <span className="rounded-full bg-white/5 px-2 py-1">line {candidate.lineStart}</span>
                        <span className="rounded-full bg-white/5 px-2 py-1">{candidate.source}</span>
                        <span className="rounded-full bg-white/5 px-2 py-1">{candidate.reason}</span>
                      </div>

                      <div className="mt-3 whitespace-pre-wrap text-sm text-zinc-200">
                        {candidate.body}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-zinc-500">
                    No summary-only candidates.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-6">
          <div className="mb-5">
            <h2 className="text-xl font-semibold">GitHub review payload preview</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Exact comment payloads prepared for the GitHub pull request review API. Not published yet.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <p className="text-sm text-zinc-400">Valid previews</p>
              <p className="mt-2 text-2xl font-semibold">{validPreviews.length}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <p className="text-sm text-zinc-400">Skipped previews</p>
              <p className="mt-2 text-2xl font-semibold">{skippedPreviews.length}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <p className="text-sm text-zinc-400">Mode</p>
              <p className="mt-2 text-sm text-zinc-300">Preview only · no GitHub writes</p>
            </div>
          </div>

          <div className="mt-8">
            <h3 className="text-sm font-medium text-zinc-300">Skipped previews</h3>
            <div className="mt-3 space-y-3">
              {skippedPreviews.length > 0 ? (
                skippedPreviews.slice(0, 5).map((preview) => (
                  <div
                    key={preview.id}
                    className="rounded-xl border border-white/10 bg-white/5 p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                      <span className="rounded-full bg-white/5 px-2 py-1">{preview.path}</span>
                      <span className="rounded-full bg-white/5 px-2 py-1">
                        {preview.skipReason ?? "unknown"}
                      </span>
                    </div>

                    <div className="mt-3 whitespace-pre-wrap text-sm text-zinc-200">
                      {preview.body}
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-zinc-500">
                  No skipped previews.
                </div>
              )}
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {validPreviews.length > 0 ? (
              validPreviews.slice(0, 5).map((preview) => (
                <div
                  key={preview.id}
                  className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                    <span className="rounded-full bg-white/5 px-2 py-1">{preview.path}</span>
                    {preview.line && (
                      <span className="rounded-full bg-white/5 px-2 py-1">line {preview.line}</span>
                    )}
                    {preview.side && (
                      <span className="rounded-full bg-white/5 px-2 py-1">{preview.side}</span>
                    )}
                  </div>

                  <pre className="mt-3 overflow-x-auto rounded-xl bg-black/40 p-4 text-xs text-zinc-300">
                    {JSON.stringify(preview.payloadJson, null, 2)}
                  </pre>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-zinc-400">
                No valid review payload previews yet.
              </div>
            )}
          </div>
        </div>

        <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-6">
          <div className="mb-5">
            <h2 className="text-xl font-semibold">Publication history</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Tracks review publish attempts for this run.
            </p>
          </div>

          {run.publications.length > 0 ? (
            <div className="space-y-3">
              {run.publications.map((publication) => (
                <div
                  key={publication.id}
                  className="rounded-xl border border-white/10 bg-zinc-900/70 p-4"
                >
                  <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-400">
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-medium ${publicationStatusClass(
                        publication.status
                      )}`}
                    >
                      {publication.status}
                    </span>

                    <span>
                      {publication.githubReviewId
                        ? `review #${publication.githubReviewId}`
                        : "no GitHub review id"}
                    </span>

                    <span>{formatDateTime(publication.createdAt)}</span>
                  </div>

                  {publication.body && (
                    <pre className="mt-3 overflow-x-auto rounded-xl bg-black/40 p-4 text-xs text-zinc-300">
                      {publication.body}
                    </pre>
                  )}

                  {publication.error && (
                    <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                      {publication.error}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-zinc-400">
              No publication attempts yet.
            </div>
          )}
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-5">
          <div className="glass-panel rounded-2xl p-5">
            <p className="text-sm text-zinc-400">Total findings</p>
            <p className="mt-2 text-2xl font-semibold">{run.findings.length}</p>
          </div>

          <div className="glass-panel rounded-2xl p-5">
            <p className="text-sm text-zinc-400">High</p>
            <p className="mt-2 text-2xl font-semibold">{severityCounts.high}</p>
          </div>

          <div className="glass-panel rounded-2xl p-5">
            <p className="text-sm text-zinc-400">Medium</p>
            <p className="mt-2 text-2xl font-semibold">{severityCounts.medium}</p>
          </div>

          <div className="glass-panel rounded-2xl p-5">
            <p className="text-sm text-zinc-400">Biome</p>
            <p className="mt-2 text-2xl font-semibold">{sourceCounts.biome}</p>
          </div>

          <div className="glass-panel rounded-2xl p-5">
            <p className="text-sm text-zinc-400">Semgrep / Ollama</p>
            <p className="mt-2 text-2xl font-semibold">
              {sourceCounts.semgrep} / {sourceCounts.ollama}
            </p>
          </div>
        </div>

        <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-6">
          <div className="mb-5">
            <h2 className="text-xl font-semibold">Top findings</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Highest-priority issues across all changed files.
            </p>
          </div>

          {topFindings.length > 0 ? (
            <div className="space-y-3">
              {topFindings.map((finding) => (
                <div key={finding.id} className={findingCardClass(finding.severity)}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="text-sm font-semibold">
                        {getDisplayFindingTitle(
                          finding.title,
                          finding.ruleId,
                          finding.explanation
                        )}
                      </div>

                      <div className="mt-1 text-sm text-zinc-300">{finding.explanation}</div>

                      <div className="mt-2 text-xs text-zinc-500">
                        {finding.path} · line {finding.lineStart}
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

                      <span className="rounded-full bg-white/5 px-2 py-1 text-xs uppercase tracking-wide">
                        {formatSourceLabel(finding.source)}
                      </span>

                      {finding.ruleId && (
                        <span className="rounded-full bg-white/5 px-2 py-1 text-xs">
                          {formatRuleLabel(finding.ruleId)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-zinc-400">
              No issues were detected in the analyzed files.
            </div>
          )}
        </div>

        <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-6">
          <div className="mb-5">
            <h2 className="text-xl font-semibold">Changed files</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Findings are grouped by file after normalization and deduplication.
            </p>
          </div>

          <div className="space-y-4">
            {run.files.map((file) => {
              const fileFindings = findingsByPath.get(file.path) ?? [];

              return (
                <div
                  key={file.id}
                  className="rounded-2xl border border-white/10 bg-zinc-900/70 p-4"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="font-medium">{file.path}</div>
                      <div className="mt-1 text-sm text-zinc-500">
                        {fileFindings.length === 0
                          ? "No issues were detected in this file."
                          : `${fileFindings.length} finding${
                              fileFindings.length === 1 ? "" : "s"
                            } in this file.`}
                      </div>
                    </div>

                    <div className="text-sm text-zinc-400">
                      {file.status} · +{file.additions} / -{file.deletions}
                    </div>
                  </div>

                  {fileFindings.length > 0 && (
                    <div className="mt-4 space-y-3">
                      {fileFindings.map((finding) => (
                        <div key={finding.id} className={findingCardClass(finding.severity)}>
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <div className="text-sm font-semibold">
                                {getDisplayFindingTitle(
                                  finding.title,
                                  finding.ruleId,
                                  finding.explanation
                                )}{" "}
                                · line {finding.lineStart}
                              </div>

                              <div className="mt-1 text-sm text-zinc-300">
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

                              <span className="rounded-full bg-white/5 px-2 py-1 text-xs uppercase tracking-wide">
                                {formatSourceLabel(finding.source)}
                              </span>

                              {finding.ruleId && (
                                <span className="rounded-full bg-white/5 px-2 py-1 text-xs">
                                  {formatRuleLabel(finding.ruleId)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {file.patch && (
                    <details className="mt-4">
                      <summary className="cursor-pointer text-sm text-zinc-400 transition hover:text-zinc-200">
                        View raw diff
                      </summary>
                      <pre className="mt-3 overflow-x-auto rounded-xl bg-black/40 p-4 text-xs text-zinc-300">
                        {file.patch}
                      </pre>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}
