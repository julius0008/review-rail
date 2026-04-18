import { z } from "zod";
import { getAppConfig } from "@repo/shared";
import { getFindingFingerprint, processFindings, rankFindingScore, type RawFinding } from "./postprocess";

type ChangedFile = {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch: string | null;
};

type FileContent = {
  path: string;
  content: string;
};

type DeterministicFinding = RawFinding;

export type LlmContextSnippet = {
  path: string;
  startLine: number;
  endLine: number;
  code: string;
  reasonIncluded: string;
};

export type LlmContextBundle = {
  path: string;
  score: number;
  reasonsIncluded: string[];
  excluded: string[];
  deterministicSummaries: Array<{
    title: string;
    severity: string;
    lineStart: number;
    explanation: string;
  }>;
  snippets: LlmContextSnippet[];
};

function coerceNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
}

function coerceBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  if (value == null) return fallback;
  return value;
}

function normalizeSeverity(value: unknown) {
  if (typeof value !== "string") return value;

  const normalized = value.trim().toLowerCase();
  if (normalized === "warn" || normalized === "warning") return "medium";
  if (normalized === "critical" || normalized === "error") return "high";
  if (normalized === "info") return "low";
  return normalized;
}

function coerceConfidence(value: unknown) {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "high") return 0.9;
    if (normalized === "medium") return 0.7;
    if (normalized === "low") return 0.4;
  }

  const coerced = coerceNumber(value);
  if (typeof coerced === "number" && coerced > 1 && coerced <= 100) {
    return coerced / 100;
  }
  return coerced;
}

function normalizeFindingShape(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;
  const location =
    typeof record.location === "object" &&
    record.location &&
    !Array.isArray(record.location)
      ? (record.location as Record<string, unknown>)
      : null;

  return {
    path: record.path ?? record.filePath ?? record.file ?? record.filename,
    lineStart:
      record.lineStart ??
      record.line ??
      record.startLine ??
      location?.lineStart ??
      location?.line,
    lineEnd: record.lineEnd ?? record.endLine ?? location?.lineEnd ?? null,
    title: record.title ?? record.issue ?? record.name ?? record.summary,
    explanation:
      record.explanation ??
      record.reason ??
      record.description ??
      record.details,
    severity: record.severity ?? record.level ?? record.priority,
    confidence: record.confidence ?? record.score ?? record.certainty,
    publishable:
      record.publishable ?? record.shouldPublish ?? record.publish ?? false,
    suggestedFixDirection:
      record.suggestedFixDirection ??
      record.suggestedFix ??
      record.fix ??
      record.suggestion,
  };
}

const llmFindingSchema = z.preprocess(normalizeFindingShape, z.object({
  path: z.string().min(1),
  lineStart: z.preprocess(coerceNumber, z.number().int().positive()),
  lineEnd: z
    .preprocess(
      (value) => (value == null ? null : coerceNumber(value)),
      z.number().int().positive().nullable()
    )
    .optional(),
  title: z.string().min(1),
  explanation: z.string().min(1),
  severity: z.preprocess(normalizeSeverity, z.enum(["high", "medium", "low"])),
  confidence: z.preprocess(coerceConfidence, z.number().min(0).max(1)),
  publishable: z.preprocess((value) => coerceBoolean(value, false), z.boolean()),
  suggestedFixDirection: z.string().nullable().optional(),
}));

const llmResponseSchema = z.object({
  findings: z.array(z.unknown()),
  summary: z.string().optional(),
});

export type ParsedLlmFinding = z.infer<typeof llmFindingSchema>;
export type LlmReviewDiagnostics = {
  rawFindingCount: number;
  invalidShapeCount: number;
  parsedFindingCount: number;
  belowConfidenceCount: number;
  overlappingCount: number;
  dedupedCount: number;
  acceptedFindingCount: number;
  parseErrors?: Array<{
    index: number;
    fields: string[];
    message: string;
  }>;
};

export type ParsedLlmResponse = {
  findings: ParsedLlmFinding[];
  summary?: string;
  diagnostics: Pick<
    LlmReviewDiagnostics,
    "rawFindingCount" | "invalidShapeCount" | "parsedFindingCount" | "parseErrors"
  >;
};

function parsePatchChangedLines(patch: string | null) {
  if (!patch) return [];

  const changedLines: number[] = [];
  const lines = patch.split("\n");
  let newLine = 0;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      const match = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (!match) continue;
      newLine = Number(match[1]);
      continue;
    }

    if (line.startsWith("+")) {
      changedLines.push(newLine);
      newLine += 1;
      continue;
    }

    if (line.startsWith(" ")) {
      newLine += 1;
    }
  }

  return changedLines;
}

function buildSnippet(content: string, targetLine: number, maxSnippetLines: number) {
  const lines = content.split("\n");
  const halfWindow = Math.max(4, Math.floor(maxSnippetLines / 2));
  const start = Math.max(1, targetLine - halfWindow);
  const end = Math.min(lines.length, targetLine + halfWindow);
  const code = lines
    .slice(start - 1, end)
    .map((line, index) => `${start + index}`.padStart(4, " ") + ` ${line}`)
    .join("\n");

  return {
    startLine: start,
    endLine: end,
    code,
  };
}

export function buildLlmReviewContextBundles(input: {
  changedFiles: ChangedFile[];
  fileContents: FileContent[];
  deterministicFindings: DeterministicFinding[];
}): LlmContextBundle[] {
  const config = getAppConfig();
  const fileContentMap = new Map(
    input.fileContents.map((file) => [file.path, file.content])
  );

  const rankedFiles = input.changedFiles
    .filter((file) => file.status !== "removed")
    .map((file) => {
      const fileFindings = input.deterministicFindings.filter(
        (finding) => finding.path === file.path
      );
      const severityScore = fileFindings.reduce(
        (total, finding) => total + rankFindingScore(finding),
        0
      );
      return {
        file,
        findings: fileFindings,
        score: severityScore + file.changes + file.additions,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, config.llm.budgets.maxFiles);

  const bundles: LlmContextBundle[] = [];
  let snippetCount = 0;

  for (const entry of rankedFiles) {
    const content = fileContentMap.get(entry.file.path);
    if (!content) continue;

    const deterministicSummaries = entry.findings
      .sort((a, b) => rankFindingScore(b) - rankFindingScore(a))
      .slice(0, config.llm.budgets.maxFindingsPerFile)
      .map((finding) => ({
        title: finding.title,
        severity: finding.severity,
        lineStart: finding.lineStart,
        explanation: finding.explanation,
      }));

    const changedLines = parsePatchChangedLines(entry.file.patch);
    const targetLines = Array.from(
      new Set([
        ...deterministicSummaries.map((finding) => finding.lineStart),
        ...changedLines.slice(0, 2),
      ])
    )
      .filter(Boolean)
      .slice(0, Math.max(1, config.llm.budgets.maxSnippets - snippetCount));

    const snippets = targetLines.map((lineStart) => {
      const snippet = buildSnippet(
        content,
        lineStart,
        config.llm.budgets.maxSnippetLines
      );

      const relatedFinding = deterministicSummaries.find(
        (finding) => Math.abs(finding.lineStart - lineStart) <= 2
      );

      return {
        path: entry.file.path,
        startLine: snippet.startLine,
        endLine: snippet.endLine,
        code: snippet.code,
        reasonIncluded: relatedFinding
          ? `Nearby deterministic finding (${relatedFinding.severity}): ${relatedFinding.title}`
          : `Changed hunk around line ${lineStart}`,
      };
    });

    snippetCount += snippets.length;

    bundles.push({
      path: entry.file.path,
      score: entry.score,
      reasonsIncluded: [
        `${entry.findings.length} deterministic findings in this file`,
        `Change size ${entry.file.changes} lines`,
      ],
      excluded: [
        "Full repository contents were excluded",
        "Unchanged files were excluded",
        "Only the highest-risk hunks and nearby findings were included",
      ],
      deterministicSummaries,
      snippets,
    });
  }

  return bundles.filter((bundle) => bundle.snippets.length > 0);
}

export function buildLlmReviewPrompt(bundle: LlmContextBundle) {
  return [
    "You are augmenting a deterministic pull request review pipeline.",
    "Review only for high-signal correctness, safety, and maintainability issues.",
    "Do not speculate. Return fewer findings rather than weak findings.",
    "If confidence is low, return no finding.",
    "Focus on bug risk, logic flaws, missing edge cases, or risky patterns not already covered by lint/static analysis.",
    "Return strict JSON with shape { findings: [...], summary?: string } and no prose outside JSON.",
    "",
    `File: ${bundle.path}`,
    `Why included: ${bundle.reasonsIncluded.join("; ")}`,
    `Excluded context: ${bundle.excluded.join("; ")}`,
    "",
    "Deterministic findings already present:",
    JSON.stringify(bundle.deterministicSummaries, null, 2),
    "",
    "Relevant snippets:",
    ...bundle.snippets.map((snippet) =>
      [
        `Snippet ${snippet.startLine}-${snippet.endLine} (${snippet.reasonIncluded})`,
        "```",
        snippet.code,
        "```",
      ].join("\n")
    ),
    "",
    "Each finding must include: path, lineStart, optional lineEnd, title, explanation, severity, confidence, publishable, optional suggestedFixDirection.",
  ].join("\n");
}

export function parseLlmReviewResponse(output: string): ParsedLlmResponse {
  const fencedMatch = output.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonSource = fencedMatch?.[1] ?? output.trim();
  const firstBrace = jsonSource.indexOf("{");
  const lastBrace = jsonSource.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error("LLM response did not contain a JSON object");
  }

  const parsed = llmResponseSchema.parse(
    JSON.parse(jsonSource.slice(firstBrace, lastBrace + 1))
  );

  const acceptedFindings: Array<z.infer<typeof llmFindingSchema>> = [];
  let invalidShapeCount = 0;
  const parseErrors: NonNullable<LlmReviewDiagnostics["parseErrors"]> = [];

  for (const [index, finding] of parsed.findings.entries()) {
    const result = llmFindingSchema.safeParse(finding);
    if (!result.success) {
      invalidShapeCount += 1;
      parseErrors.push({
        index,
        fields: result.error.issues.map((issue) => issue.path.join(".") || "root"),
        message: result.error.issues[0]?.message ?? "Invalid finding shape",
      });
      continue;
    }
    acceptedFindings.push(result.data);
  }

  return {
    findings: acceptedFindings,
    summary: parsed.summary,
    diagnostics: {
      rawFindingCount: parsed.findings.length,
      invalidShapeCount,
      parsedFindingCount: acceptedFindings.length,
      parseErrors,
    },
  };
}

function overlapsDeterministicFinding(
  finding: RawFinding,
  deterministicFindings: DeterministicFinding[]
) {
  return deterministicFindings.some((existing) => {
    const samePath = existing.path === finding.path;
    const nearbyLine = Math.abs(existing.lineStart - finding.lineStart) <= 2;
    const titleOverlap =
      existing.title.toLowerCase() === finding.title.toLowerCase() ||
      existing.explanation
        .toLowerCase()
        .includes(finding.title.toLowerCase().slice(0, 20));

    return samePath && nearbyLine && titleOverlap;
  });
}

export function mergeLlmFindings(input: {
  parsed: ParsedLlmResponse;
  deterministicFindings: DeterministicFinding[];
}): { findings: RawFinding[]; diagnostics: LlmReviewDiagnostics } {
  const config = getAppConfig();

  const candidateFindings: RawFinding[] = input.parsed.findings.map((finding) => ({
    path: finding.path,
    lineStart: finding.lineStart,
    lineEnd: finding.lineEnd ?? null,
    category: "llm-review",
    severity: finding.severity,
    confidence: finding.confidence,
    title: finding.title,
    explanation: finding.explanation,
    actionableFix: finding.suggestedFixDirection ?? null,
    source: "ollama",
    origin: "llm",
    ruleId: null,
    publish: finding.publishable,
    metadata: null,
  }));

  let belowConfidenceCount = 0;
  let overlappingCount = 0;

  const filtered = candidateFindings.filter((finding) => {
    if (finding.confidence < config.llm.confidenceThreshold) {
      belowConfidenceCount += 1;
      return false;
    }

    if (overlapsDeterministicFinding(finding, input.deterministicFindings)) {
      overlappingCount += 1;
      return false;
    }

    return true;
  });

  const deduped = processFindings(filtered).map((finding) => ({
    ...finding,
    metadata: {
      provider: "ollama",
      fingerprint: getFindingFingerprint(finding),
    },
  }));

  return {
    findings: deduped,
    diagnostics: {
      rawFindingCount: input.parsed.diagnostics.rawFindingCount,
      invalidShapeCount: input.parsed.diagnostics.invalidShapeCount,
      parsedFindingCount: input.parsed.diagnostics.parsedFindingCount,
      belowConfidenceCount,
      overlappingCount,
      dedupedCount: filtered.length - deduped.length,
      acceptedFindingCount: deduped.length,
      parseErrors: input.parsed.diagnostics.parseErrors ?? [],
    },
  };
}
