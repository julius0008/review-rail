export type RawFinding = {
  path: string;
  lineStart: number;
  lineEnd?: number | null;
  category: string;
  severity: string;
  confidence: number;
  title: string;
  explanation: string;
  actionableFix?: string | null;
  source: string;
  ruleId?: string | null;
  publish: boolean;
  origin?: "deterministic" | "llm";
  metadata?: Record<string, unknown> | null;
};

function normalizeSeverity(severity: string): "high" | "medium" | "low" {
  const value = severity.toLowerCase();

  if (value === "error" || value === "high") return "high";
  if (value === "warning" || value === "warn" || value === "medium") return "medium";
  return "low";
}

function sourcePriority(source: string): number {
  if (source === "semgrep") return 3;
  if (source === "biome") return 2;
  if (source === "ollama") return 1;
  return 1;
}

function normalizeRuleLabel(ruleId?: string | null): string | null {
  if (!ruleId) return null;

  const parts = ruleId.split(".");
  return parts[parts.length - 1] ?? ruleId;
}

type CanonicalFinding = Pick<
  RawFinding,
  "ruleId" | "title" | "explanation"
>;

function getCanonicalIssueId(finding: CanonicalFinding): string {
  const ruleId = (finding.ruleId ?? "").toLowerCase();
  const title = finding.title.toLowerCase();
  const explanation = finding.explanation.toLowerCase();
  const combined = `${ruleId} ${title} ${explanation}`;

  if (
    combined.includes("noglobaleval") ||
    combined.includes("no-eval") ||
    combined.includes(" eval(") ||
    combined.includes("avoid eval")
  ) {
    return "dangerous-eval";
  }

  if (
    combined.includes("no-child-process-exec") ||
    combined.includes("child_process.exec") ||
    combined.includes(" exec(")
  ) {
    return "child-process-exec";
  }

  if (
    combined.includes("no-insecure-random") ||
    combined.includes("math.random")
  ) {
    return "insecure-random";
  }

  if (
    combined.includes("no-json-parse-direct-request-body") ||
    combined.includes("json.parse")
  ) {
    return "unsafe-json-parse";
  }

  if (
    combined.includes("noexplicitany") ||
    combined.includes("no-explicit-any")
  ) {
    return "explicit-any";
  }

  if (
    combined.includes("notsignore") ||
    combined.includes("no-ts-ignore")
  ) {
    return "ts-ignore";
  }

  if (
    combined.includes("usedconst") ||
    combined.includes("use-const")
  ) {
    return "use-const";
  }

  if (
    combined.includes("nodebugger") ||
    combined.includes("no-debugger") ||
    combined.includes("debugger")
  ) {
    return "debugger-statement";
  }

  return normalizeRuleLabel(finding.ruleId) ?? finding.title.toLowerCase();
}

export function getFindingFingerprint(finding: Pick<RawFinding, "path" | "lineStart" | "ruleId" | "title" | "explanation">): string {
  return [
    finding.path,
    finding.lineStart,
    getCanonicalIssueId(finding),
  ].join("::");
}

function normalizedIssueKey(finding: RawFinding): string {
  return getFindingFingerprint(finding);
}

function severityRank(severity: string): number {
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  return 1;
}

function shouldReplace(existing: RawFinding, incoming: RawFinding): boolean {
  const existingScore =
    sourcePriority(existing.source) * 100 +
    severityRank(existing.severity) * 10 +
    existing.confidence;

  const incomingScore =
    sourcePriority(incoming.source) * 100 +
    severityRank(incoming.severity) * 10 +
    incoming.confidence;

  return incomingScore > existingScore;
}

export function processFindings(findings: RawFinding[]): RawFinding[] {
  const normalized = findings.map((finding) => ({
    ...finding,
    severity: normalizeSeverity(finding.severity),
    ruleId: finding.ruleId ?? null,
    origin: finding.origin ?? "deterministic",
    metadata: finding.metadata ?? null,
  }));

  const deduped = new Map<string, RawFinding>();

  for (const finding of normalized) {
    const key = normalizedIssueKey(finding);
    const existing = deduped.get(key);

    if (!existing) {
      deduped.set(key, finding);
      continue;
    }

    if (shouldReplace(existing, finding)) {
      deduped.set(key, finding);
    }
  }

  return [...deduped.values()].sort((a, b) => {
    if (a.path !== b.path) return a.path.localeCompare(b.path);
    if (a.lineStart !== b.lineStart) return a.lineStart - b.lineStart;

    const severityDiff = severityRank(b.severity) - severityRank(a.severity);
    if (severityDiff !== 0) return severityDiff;

    return a.source.localeCompare(b.source);
  });
}

export function getDisplayRuleLabel(ruleId?: string | null): string | null {
  return normalizeRuleLabel(ruleId);
}

export function rankFindingScore(finding: Pick<RawFinding, "severity" | "confidence" | "source" | "origin">) {
  const base =
    severityRank(normalizeSeverity(finding.severity)) * 100 +
    Math.round(finding.confidence * 100);

  const sourceBoost = sourcePriority(finding.source) * 15;
  const originBoost = finding.origin === "deterministic" ? 10 : 0;

  return base + sourceBoost + originBoost;
}
