type PreviewRecord = {
  id?: string;
  path: string;
  body: string;
  line: number | null;
  side: string | null;
  startLine: number | null;
  startSide: string | null;
  isValid: boolean;
  skipReason: string | null;
  metadata?: unknown;
};

export function selectPublishableReviewComments(
  previews: PreviewRecord[],
  maxComments = 5
): Array<{
  path: string;
  body: string;
  line: number;
  side: "RIGHT" | "LEFT";
  start_line: number | null;
  start_side: "RIGHT" | "LEFT" | null;
}> {
  const getScore = (metadata: unknown) => {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      return 0;
    }

    const score = (metadata as Record<string, unknown>).score;
    return typeof score === "number" ? score : 0;
  };

  return previews
    .filter(
      (preview) =>
        preview.isValid &&
        preview.line != null &&
        (preview.side === "RIGHT" || preview.side === "LEFT")
    )
    .sort((a, b) => {
      const scoreA = getScore(a.metadata);
      const scoreB = getScore(b.metadata);
      return scoreB - scoreA;
    })
    .slice(0, maxComments)
    .map((preview) => ({
      path: preview.path,
      body: preview.body,
      line: preview.line as number,
      side: preview.side as "RIGHT" | "LEFT",
      start_line: preview.startLine ?? null,
      start_side:
        preview.startSide === "RIGHT" || preview.startSide === "LEFT"
          ? preview.startSide
          : null,
    }));
}

export function buildPublishedReviewBody(input: {
  repoId: string;
  prNumber: number;
  totalFindings: number;
  totalComments: number;
  deterministicFindings?: number;
  llmFindings?: number;
  summary?: string | null;
}) {
  const summary = input.summary?.trim()
    ? input.summary.trim()
    : `Detected ${input.totalFindings} findings in this pull request.`;

  return [
    `Automated review for ${input.repoId} PR #${input.prNumber}.`,
    "",
    summary,
    "",
    `Signal sources: ${input.deterministicFindings ?? input.totalFindings} deterministic, ${input.llmFindings ?? 0} LLM-augmented findings.`,
    "",
    `Posted ${input.totalComments} inline comment${input.totalComments === 1 ? "" : "s"} from the highest-signal findings.`,
  ].join("\n");
}
