import type {
  DashboardRunDto,
  ReviewFindingDto,
} from "@/lib/review-run-types";

export function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    queued: "bg-amber-500/15 text-amber-200 ring-1 ring-amber-400/30",
    fetching: "bg-sky-500/15 text-sky-200 ring-1 ring-sky-400/30",
    analyzing: "bg-indigo-500/15 text-indigo-200 ring-1 ring-indigo-400/30",
    postprocessing: "bg-violet-500/15 text-violet-200 ring-1 ring-violet-400/30",
    llm_pending: "bg-cyan-500/15 text-cyan-200 ring-1 ring-cyan-400/30",
    publish_ready: "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/30",
    completed: "bg-white/10 text-zinc-100 ring-1 ring-white/15",
    failed: "bg-red-500/15 text-red-200 ring-1 ring-red-400/30",
    stale: "bg-white/8 text-zinc-400 ring-1 ring-white/10",
  };

  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
        styles[status] ?? "bg-zinc-700 text-zinc-200"
      }`}
    >
      {status}
    </span>
  );
}

export function LlmPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    disabled: "bg-white/8 text-zinc-400 ring-1 ring-white/10",
    pending: "bg-cyan-500/15 text-cyan-200 ring-1 ring-cyan-400/30",
    running: "bg-cyan-500/15 text-cyan-200 ring-1 ring-cyan-400/30",
    completed: "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/30",
    skipped: "bg-white/10 text-zinc-200 ring-1 ring-white/10",
    failed: "bg-red-500/15 text-red-200 ring-1 ring-red-400/30",
  };

  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
        styles[status] ?? styles.disabled
      }`}
    >
      LLM {status.replace("_", " ")}
    </span>
  );
}

export function PublishPill({ state }: { state: string }) {
  const styles: Record<string, string> = {
    idle: "bg-white/8 text-zinc-300 ring-1 ring-white/10",
    publishing: "bg-blue-500/15 text-blue-200 ring-1 ring-blue-400/30",
    published: "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/30",
    failed: "bg-red-500/15 text-red-200 ring-1 ring-red-400/30",
  };

  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
        styles[state] ?? styles.idle
      }`}
    >
      Publish {state}
    </span>
  );
}

export function publicationStatusClass(status: string) {
  if (status === "published") {
    return "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/20";
  }

  if (status === "publishing") {
    return "bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/20";
  }

  if (status === "failed") {
    return "bg-red-500/15 text-red-300 ring-1 ring-red-500/20";
  }

  return "bg-zinc-700 text-zinc-200";
}

export function publishStateClass(status: string) {
  return publicationStatusClass(status);
}

export function llmStatusClass(status: string) {
  const styles: Record<string, string> = {
    disabled: "bg-white/8 text-zinc-400 ring-1 ring-white/10",
    pending: "bg-cyan-500/15 text-cyan-200 ring-1 ring-cyan-400/30",
    running: "bg-cyan-500/15 text-cyan-200 ring-1 ring-cyan-400/30",
    completed: "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/30",
    skipped: "bg-white/10 text-zinc-200 ring-1 ring-white/10",
    failed: "bg-red-500/15 text-red-200 ring-1 ring-red-400/30",
  };

  return styles[status] ?? styles.disabled;
}

export function severityBadgeClass(severity: string) {
  if (severity === "high") {
    return "bg-red-500/15 text-red-300 ring-1 ring-red-500/20";
  }

  if (severity === "medium") {
    return "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/20";
  }

  return "bg-zinc-700 text-zinc-200";
}

export function findingCardClass(severity: string) {
  if (severity === "high") {
    return "rounded-xl border border-red-500/20 bg-red-500/10 p-4";
  }

  if (severity === "medium") {
    return "rounded-xl border border-amber-500/20 bg-amber-500/10 p-4";
  }

  return "rounded-xl border border-zinc-700 bg-zinc-800/60 p-4";
}

export function formatSourceLabel(source: string) {
  if (source === "semgrep") return "Semgrep";
  if (source === "biome") return "Biome";
  return source.charAt(0).toUpperCase() + source.slice(1);
}

export function formatRuleLabel(ruleId?: string | null) {
  if (!ruleId) return null;
  const parts = ruleId.split(".");
  return parts[parts.length - 1] ?? ruleId;
}

export function getDisplayFindingTitle(
  title: string,
  ruleId?: string | null,
  explanation?: string | null
) {
  const combined = `${ruleId ?? ""} ${title} ${explanation ?? ""}`.toLowerCase();

  if (combined.includes("eval")) return "Avoid eval()";
  if (
    combined.includes("child_process.exec") ||
    combined.includes("no-child-process-exec")
  ) {
    return "Avoid child_process.exec()";
  }
  if (combined.includes("math.random")) return "Avoid insecure randomness";
  if (combined.includes("json.parse")) return "Validate parsed input";
  if (
    combined.includes("explicitany") ||
    combined.includes("explicit any") ||
    combined.includes("no-explicit-any")
  ) {
    return "Avoid explicit any";
  }
  if (combined.includes("ts-ignore")) return "Avoid @ts-ignore";
  if (combined.includes("debugger")) return "Remove debugger statement";
  if (combined.includes("useconst") || combined.includes("use-const")) {
    return "Use const instead of let";
  }

  return title;
}

export function findingSortRank(severity: string) {
  if (severity === "high") return 0;
  if (severity === "medium") return 1;
  return 2;
}

export function formatDateTime(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

export function getStatusStepClass(currentStatus: string, step: string) {
  const order = [
    "queued",
    "fetching",
    "analyzing",
    "postprocessing",
    "llm_pending",
    "publish_ready",
    "completed",
  ];
  const currentIndex = order.indexOf(currentStatus);
  const stepIndex = order.indexOf(step);

  if (currentStatus === "failed" && stepIndex >= 0) {
    return "border-red-500/20 bg-red-500/10 text-red-300";
  }

  if (currentIndex >= stepIndex && currentIndex !== -1) {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";
  }

  return "border-white/10 bg-white/5 text-zinc-500";
}

export function readJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function readJsonArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];

  return value.filter(
    (entry) => entry && typeof entry === "object" && !Array.isArray(entry)
  ) as Array<Record<string, unknown>>;
}

export function buildSummarySentence(
  findings: Array<{ severity: string; source: string }>
) {
  if (findings.length === 0) {
    return "No issues were detected in the analyzed files.";
  }

  const high = findings.filter((finding) => finding.severity === "high").length;
  const medium = findings.filter(
    (finding) => finding.severity === "medium"
  ).length;
  const low = findings.filter((finding) => finding.severity === "low").length;
  const semgrep = findings.filter((finding) => finding.source === "semgrep").length;
  const biome = findings.filter((finding) => finding.source === "biome").length;

  return `Detected ${findings.length} findings across the changed files, including ${high} high-severity, ${medium} medium-severity, and ${low} low-severity issues. ${semgrep} came from Semgrep and ${biome} came from Biome after normalization and deduplication.`;
}

export function getReviewRunPath(reviewRunId: string) {
  return `/reviews/${reviewRunId}`;
}

export function buildFindingsByPath(findings: ReviewFindingDto[]) {
  const findingsByPath = new Map<string, ReviewFindingDto[]>();

  for (const finding of findings) {
    const existing = findingsByPath.get(finding.path) ?? [];
    existing.push(finding);
    findingsByPath.set(finding.path, existing);
  }

  for (const [path, groupedFindings] of findingsByPath.entries()) {
    groupedFindings.sort((a, b) => {
      const severityDiff = findingSortRank(a.severity) - findingSortRank(b.severity);
      if (severityDiff !== 0) return severityDiff;
      if (a.lineStart !== b.lineStart) return a.lineStart - b.lineStart;
      return a.source.localeCompare(b.source);
    });

    findingsByPath.set(path, groupedFindings);
  }

  return findingsByPath;
}

export function getTopFindings(findings: ReviewFindingDto[]) {
  return [...findings]
    .sort((a, b) => {
      const severityDiff = findingSortRank(a.severity) - findingSortRank(b.severity);
      if (severityDiff !== 0) return severityDiff;
      if (a.path !== b.path) return a.path.localeCompare(b.path);
      return a.lineStart - b.lineStart;
    })
    .slice(0, 5);
}

export function getDashboardRunIds(runs: DashboardRunDto[]) {
  return runs.map((run) => run.id);
}
