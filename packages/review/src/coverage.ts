import { z } from "zod";

export type AnalyzableChangedFile = {
  path: string;
  status: string;
  changes: number;
  additions?: number;
  deletions?: number;
  patch?: string | null;
};

export type ReviewCoverageReason = "file_budget" | "line_budget";
export type ReviewCoverageMode = "full" | "partial";

export type ReviewAnalysisBudget = {
  maxAnalyzedFiles: number;
  maxChangedLines: number;
};

export type ReviewRunCoverage = {
  mode: ReviewCoverageMode;
  analyzableFileCount: number;
  analyzedFileCount: number;
  skippedFileCount: number;
  skippedPaths: string[];
  reason: ReviewCoverageReason | null;
};

export type ReviewRunTimings = {
  fetchMs: number | null;
  biomeMs: number | null;
  semgrepMs: number | null;
  postprocessMs: number | null;
  publishMs: number | null;
  totalMs: number | null;
};

export type ReviewRunMetadata = {
  coverage: ReviewRunCoverage;
  timings: ReviewRunTimings;
  progress?: {
    stage: string;
    filesFetched: number;
    filesAnalyzed: number;
    filesSkipped: number;
    totalFiles: number;
  };
};

const reviewCoverageSchema = z.object({
  mode: z.enum(["full", "partial"]),
  analyzableFileCount: z.number().int().nonnegative(),
  analyzedFileCount: z.number().int().nonnegative(),
  skippedFileCount: z.number().int().nonnegative(),
  skippedPaths: z.array(z.string()),
  reason: z.enum(["file_budget", "line_budget"]).nullable(),
});

const reviewRunTimingsSchema = z.object({
  fetchMs: z.number().int().nonnegative().nullable(),
  biomeMs: z.number().int().nonnegative().nullable(),
  semgrepMs: z.number().int().nonnegative().nullable(),
  postprocessMs: z.number().int().nonnegative().nullable(),
  publishMs: z.number().int().nonnegative().nullable(),
  totalMs: z.number().int().nonnegative().nullable(),
});

const reviewRunMetadataSchema = z.object({
  coverage: reviewCoverageSchema,
  timings: reviewRunTimingsSchema,
  progress: z
    .object({
      stage: z.string(),
      filesFetched: z.number().int().nonnegative(),
      filesAnalyzed: z.number().int().nonnegative(),
      filesSkipped: z.number().int().nonnegative(),
      totalFiles: z.number().int().nonnegative(),
    })
    .optional(),
});

const ANALYZABLE_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx"];

export function isAnalyzableSourceFile(path: string, status: string) {
  return (
    status !== "removed" &&
    ANALYZABLE_EXTENSIONS.some((extension) => path.endsWith(extension))
  );
}

export function buildAnalysisPlan(
  files: AnalyzableChangedFile[],
  budget: ReviewAnalysisBudget
) {
  const analyzableFiles = files
    .filter((file) => isAnalyzableSourceFile(file.path, file.status))
    .sort((a, b) => {
      if (b.changes !== a.changes) return b.changes - a.changes;
      return a.path.localeCompare(b.path);
    });

  const filesToAnalyze: AnalyzableChangedFile[] = [];
  const skippedFiles: AnalyzableChangedFile[] = [];
  let consumedChangedLines = 0;
  let reason: ReviewCoverageReason | null = null;

  for (const file of analyzableFiles) {
    const nextFileCount = filesToAnalyze.length + 1;
    const nextChangedLines = consumedChangedLines + file.changes;

    if (nextFileCount > budget.maxAnalyzedFiles) {
      reason ??= "file_budget";
      skippedFiles.push(file);
      continue;
    }

    if (filesToAnalyze.length > 0 && nextChangedLines > budget.maxChangedLines) {
      reason ??= "line_budget";
      skippedFiles.push(file);
      continue;
    }

    filesToAnalyze.push(file);
    consumedChangedLines = nextChangedLines;
  }

  const coverage: ReviewRunCoverage = {
    mode: skippedFiles.length > 0 ? "partial" : "full",
    analyzableFileCount: analyzableFiles.length,
    analyzedFileCount: filesToAnalyze.length,
    skippedFileCount: skippedFiles.length,
    skippedPaths: skippedFiles.map((file) => file.path),
    reason,
  };

  return {
    analyzableFiles,
    filesToAnalyze,
    skippedFiles,
    coverage,
  };
}

export function buildCoverageSummary(coverage: ReviewRunCoverage) {
  if (coverage.analyzableFileCount === 0) {
    return "Observer found no analyzable source files in this pull request.";
  }

  if (coverage.mode === "full") {
    return `Observer analyzed all ${coverage.analyzedFileCount} analyzable file${coverage.analyzedFileCount === 1 ? "" : "s"}.`;
  }

  return `Observer analyzed ${coverage.analyzedFileCount} of ${coverage.analyzableFileCount} analyzable files; ${coverage.skippedFileCount} ${coverage.skippedFileCount === 1 ? "was" : "were"} skipped to keep this run reliable.`;
}

export function createEmptyReviewRunTimings(): ReviewRunTimings {
  return {
    fetchMs: null,
    biomeMs: null,
    semgrepMs: null,
    postprocessMs: null,
    publishMs: null,
    totalMs: null,
  };
}

export function parseReviewRunMetadata(value: unknown): ReviewRunMetadata | null {
  const parsed = reviewRunMetadataSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
