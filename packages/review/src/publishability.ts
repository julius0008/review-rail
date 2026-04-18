import { getFindingFingerprint, rankFindingScore } from "./postprocess";

export type ProcessedFinding = {
  id?: string;
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
  fingerprint?: string;
  metadata?: Record<string, unknown> | null;
};

export type CommentCandidate = {
  id?: string;
  findingId?: string | null;
  findingFingerprint?: string | null;
  path: string;
  lineStart: number;
  lineEnd?: number | null;
  body: string;
  severity: string;
  source: string;
  isPublishable: boolean;
  reason: string;
  metadata?: Record<string, unknown> | null;
};

function normalizeRule(ruleId?: string | null) {
  if (!ruleId) return "";
  const parts = ruleId.split(".");
  return (parts[parts.length - 1] ?? ruleId).toLowerCase();
}

function isHighSignalFinding(finding: ProcessedFinding) {
  const rule = normalizeRule(finding.ruleId);
  const text = `${finding.title} ${finding.explanation} ${rule}`.toLowerCase();

  if (finding.severity === "high") return true;
  if (finding.source === "semgrep" && finding.severity === "medium") return true;

  if (text.includes("eval")) return true;
  if (text.includes("child_process.exec")) return true;
  if (text.includes("insecure-random")) return true;
  if (text.includes("math.random")) return true;

  return false;
}

function isPublishableLlmFinding(finding: ProcessedFinding) {
  return (
    finding.source === "ollama" &&
    (finding.origin ?? "llm") === "llm" &&
    finding.confidence >= 0.9 &&
    finding.severity !== "low"
  );
}

function isLowValueStyleFinding(finding: ProcessedFinding) {
  const rule = normalizeRule(finding.ruleId);
  const text = `${finding.title} ${finding.explanation} ${rule}`.toLowerCase();

  if (finding.severity === "low") return true;
  if (text.includes("useconst") || text.includes("use-const")) return true;

  return false;
}

function toCommentBody(finding: ProcessedFinding) {
  const title = finding.title.replace(/^Biome:\s*/i, "").trim();

  if (finding.actionableFix) {
    return `**${title}**\n\n${finding.explanation}\n\nSuggested direction: ${finding.actionableFix}`;
  }

  return `**${title}**\n\n${finding.explanation}`;
}

export function buildCommentCandidates(findings: ProcessedFinding[]): CommentCandidate[] {
  return findings.map((finding) => {
    const score = rankFindingScore({
      severity: finding.severity,
      confidence: finding.confidence,
      source: finding.source,
      origin: finding.origin ?? (finding.source === "ollama" ? "llm" : "deterministic"),
    });
    const findingFingerprint =
      finding.fingerprint ??
      getFindingFingerprint({
        path: finding.path,
        lineStart: finding.lineStart,
        ruleId: finding.ruleId,
        title: finding.title,
        explanation: finding.explanation,
      });

    if (isLowValueStyleFinding(finding)) {
      return {
        id: finding.id,
        findingId: finding.id ?? null,
        findingFingerprint,
        path: finding.path,
        lineStart: finding.lineStart,
        lineEnd: finding.lineEnd ?? null,
        body: toCommentBody(finding),
        severity: finding.severity,
        source: finding.source,
        isPublishable: false,
        reason: "suppressed_low_value_style",
        metadata: {
          score,
          source: finding.source,
          reason: "suppressed_low_value_style",
        },
      };
    }

    if (finding.source === "ollama" && !isPublishableLlmFinding(finding)) {
      return {
        id: finding.id,
        findingId: finding.id ?? null,
        findingFingerprint,
        path: finding.path,
        lineStart: finding.lineStart,
        lineEnd: finding.lineEnd ?? null,
        body: toCommentBody(finding),
        severity: finding.severity,
        source: finding.source,
        isPublishable: false,
        reason:
          finding.confidence < 0.9
            ? "suppressed_low_confidence_llm"
            : "summary_only_llm",
        metadata: {
          score,
          source: finding.source,
          reason:
            finding.confidence < 0.9
              ? "suppressed_low_confidence_llm"
              : "summary_only_llm",
        },
      };
    }

    if (isHighSignalFinding(finding)) {
      return {
        id: finding.id,
        findingId: finding.id ?? null,
        findingFingerprint,
        path: finding.path,
        lineStart: finding.lineStart,
        lineEnd: finding.lineEnd ?? null,
        body: toCommentBody(finding),
        severity: finding.severity,
        source: finding.source,
        isPublishable: true,
        reason:
          finding.source === "ollama"
            ? "publishable_llm_high_confidence"
            : "publishable_high_signal",
        metadata: {
          score,
          source: finding.source,
          reason:
            finding.source === "ollama"
              ? "publishable_llm_high_confidence"
              : "publishable_high_signal",
        },
      };
    }

    return {
      id: finding.id,
      findingId: finding.id ?? null,
      findingFingerprint,
      path: finding.path,
      lineStart: finding.lineStart,
      lineEnd: finding.lineEnd ?? null,
      body: toCommentBody(finding),
      severity: finding.severity,
      source: finding.source,
      isPublishable: false,
      reason: "summary_only",
      metadata: {
        score,
        source: finding.source,
        reason: "summary_only",
      },
    };
  });
}
