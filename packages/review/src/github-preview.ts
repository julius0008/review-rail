type CommentCandidate = {
  id?: string;
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

type ChangedFile = {
  path: string;
  patch: string | null;
};

export type ReviewPreview = {
  candidateId?: string;
  path: string;
  body: string;
  line: number | null;
  side: "RIGHT" | "LEFT" | null;
  startLine: number | null;
  startSide: "RIGHT" | "LEFT" | null;
  commitId: string | null;
  isValid: boolean;
  skipReason: string | null;
  payloadJson: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
};

function parseHunkHeader(header: string) {
  const match = header.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  if (!match) return null;

  return {
    oldStart: Number(match[1]),
    newStart: Number(match[2]),
  };
}

function getCommentableRightLinesFromPatch(patch: string | null): Set<number> {
  const lines = new Set<number>();

  if (!patch) return lines;

  const patchLines = patch.split("\n");
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const rawLine of patchLines) {
    if (rawLine.startsWith("@@")) {
      const parsed = parseHunkHeader(rawLine);
      if (!parsed) continue;

      oldLine = parsed.oldStart;
      newLine = parsed.newStart;
      inHunk = true;
      continue;
    }

    if (!inHunk) continue;

    if (rawLine.startsWith("+")) {
      lines.add(newLine);
      newLine += 1;
      continue;
    }

    if (rawLine.startsWith("-")) {
      oldLine += 1;
      continue;
    }

    if (rawLine.startsWith(" ")) {
      lines.add(newLine);
      oldLine += 1;
      newLine += 1;
      continue;
    }

    // Ignore "\ No newline at end of file"
    if (rawLine.startsWith("\\")) {
      continue;
    }
  }

  return lines;
}

function buildSingleLinePreview(input: {
  candidate: CommentCandidate;
  headSha: string;
}): ReviewPreview {
  return {
    candidateId: input.candidate.id,
    path: input.candidate.path,
    body: input.candidate.body,
    line: input.candidate.lineStart,
    side: "RIGHT",
    startLine: null,
    startSide: null,
    commitId: input.headSha,
    isValid: true,
    skipReason: null,
    payloadJson: {
      path: input.candidate.path,
      body: input.candidate.body,
      line: input.candidate.lineStart,
      side: "RIGHT",
      commit_id: input.headSha,
    },
    metadata: input.candidate.metadata ?? null,
  };
}

export function buildGitHubReviewPreviews(input: {
  candidates: CommentCandidate[];
  changedFiles: ChangedFile[];
  headSha: string;
}): ReviewPreview[] {
  const filesByPath = new Map(input.changedFiles.map((file) => [file.path, file]));

  return input.candidates.map((candidate) => {
    if (!candidate.isPublishable) {
      return {
        candidateId: candidate.id,
        path: candidate.path,
        body: candidate.body,
        line: null,
        side: null,
        startLine: null,
        startSide: null,
        commitId: null,
        isValid: false,
        skipReason: "not_publishable",
        payloadJson: null,
        metadata: candidate.metadata ?? null,
      };
    }

    const changedFile = filesByPath.get(candidate.path);

    if (!changedFile) {
      return {
        candidateId: candidate.id,
        path: candidate.path,
        body: candidate.body,
        line: null,
        side: null,
        startLine: null,
        startSide: null,
        commitId: null,
        isValid: false,
        skipReason: "path_not_in_changed_files",
        payloadJson: null,
        metadata: candidate.metadata ?? null,
      };
    }

    if (!changedFile.patch) {
      return {
        candidateId: candidate.id,
        path: candidate.path,
        body: candidate.body,
        line: null,
        side: null,
        startLine: null,
        startSide: null,
        commitId: null,
        isValid: false,
        skipReason: "missing_patch",
        payloadJson: null,
        metadata: candidate.metadata ?? null,
      };
    }

    const rightLines = getCommentableRightLinesFromPatch(changedFile.patch);

    if (!rightLines.has(candidate.lineStart)) {
      return {
        candidateId: candidate.id,
        path: candidate.path,
        body: candidate.body,
        line: null,
        side: null,
        startLine: null,
        startSide: null,
        commitId: null,
        isValid: false,
        skipReason: "line_not_in_patch",
        payloadJson: null,
        metadata: candidate.metadata ?? null,
      };
    }

    return buildSingleLinePreview({
      candidate,
      headSha: input.headSha,
    });
  });
}
