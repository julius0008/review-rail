type SummaryFinding = {
  path: string;
  severity: string;
  source: string;
  confidence?: number;
  title?: string;
};

export function buildReviewSummary(findings: SummaryFinding[]) {
  if (findings.length === 0) {
    return "No issues were detected in the analyzed files.";
  }

  const high = findings.filter((f) => f.severity === "high").length;
  const medium = findings.filter((f) => f.severity === "medium").length;
  const low = findings.filter((f) => f.severity === "low").length;

  const bySource = findings.reduce<Record<string, number>>((acc, finding) => {
    acc[finding.source] = (acc[finding.source] ?? 0) + 1;
    return acc;
  }, {});

  const sourceText = Object.entries(bySource)
    .map(([source, count]) => `${count} from ${source}`)
    .join(", ");

  const topTitles = findings
    .filter((finding) => finding.severity !== "low")
    .slice(0, 3)
    .map((finding) => finding.title)
    .filter(Boolean)
    .join("; ");

  return [
    `Detected ${findings.length} findings across the changed files: ${high} high, ${medium} medium, and ${low} low severity.`,
    `Source breakdown: ${sourceText}.`,
    topTitles ? `Top review themes: ${topTitles}.` : null,
  ]
    .filter(Boolean)
    .join(" ");
}
