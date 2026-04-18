import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFindingDelta,
  buildMergeBlockReason,
  buildReviewPublicationPlan,
  deriveReviewOutcome,
} from "./publish";

test("deriveReviewOutcome returns blocking for publishable high-signal candidates", () => {
  const outcome = deriveReviewOutcome({
    status: "completed",
    findings: [
      {
        path: "src/demo.ts",
        lineStart: 8,
        severity: "high",
        source: "semgrep",
        title: "Avoid eval()",
        explanation: "Avoid eval usage.",
      },
    ],
    commentCandidates: [
      {
        path: "src/demo.ts",
        lineStart: 8,
        severity: "high",
        source: "semgrep",
        isPublishable: true,
        reason: "publishable_high_signal",
      },
    ],
  });

  assert.equal(outcome, "blocking");
});

test("buildMergeBlockReason summarizes blocking sources", () => {
  const reason = buildMergeBlockReason([
    {
      path: "src/demo.ts",
      lineStart: 8,
      severity: "high",
      source: "semgrep",
      isPublishable: true,
      reason: "publishable_high_signal",
    },
    {
      path: "src/demo.ts",
      lineStart: 12,
      severity: "medium",
      source: "ollama",
      isPublishable: true,
      reason: "publishable_llm_high_confidence",
    },
  ]);

  assert.match(reason ?? "", /blocking merge/i);
  assert.match(reason ?? "", /Semgrep/i);
  assert.match(reason ?? "", /Ollama/i);
});

test("buildFindingDelta compares current and previous fingerprints", () => {
  const delta = buildFindingDelta({
    currentFindings: [
      {
        fingerprint: "a",
        path: "src/a.ts",
        lineStart: 1,
        severity: "high",
        source: "semgrep",
        title: "A",
        explanation: "A",
      },
      {
        fingerprint: "b",
        path: "src/b.ts",
        lineStart: 2,
        severity: "medium",
        source: "biome",
        title: "B",
        explanation: "B",
      },
    ],
    previousFindings: [
      {
        fingerprint: "a",
        path: "src/a.ts",
        lineStart: 1,
        severity: "high",
        source: "semgrep",
        title: "A",
        explanation: "A",
      },
      {
        fingerprint: "c",
        path: "src/c.ts",
        lineStart: 3,
        severity: "medium",
        source: "biome",
        title: "C",
        explanation: "C",
      },
    ],
  });

  assert.deepEqual(delta, {
    newFindings: 1,
    resolvedFindings: 1,
    persistentFindings: 1,
  });
});

test("buildReviewPublicationPlan requests changes for blocking runs", () => {
  const plan = buildReviewPublicationPlan({
    repoId: "acme/demo",
    prNumber: 42,
    findings: [
      {
        path: "src/demo.ts",
        lineStart: 8,
        severity: "high",
        source: "semgrep",
        title: "Avoid eval()",
        explanation: "Avoid eval usage.",
      },
    ],
    commentCandidates: [
      {
        id: "candidate-1",
        path: "src/demo.ts",
        lineStart: 8,
        severity: "high",
        source: "semgrep",
        isPublishable: true,
        reason: "publishable_high_signal",
      },
    ],
    commentPreviews: [
      {
        id: "preview-1",
        path: "src/demo.ts",
        body: "test",
        line: 8,
        side: "RIGHT",
        startLine: null,
        startSide: null,
        isValid: true,
        skipReason: null,
        metadata: { score: 250 },
      },
    ],
    latestPublishedReviewEvent: null,
  });

  assert.equal(plan.reviewOutcome, "blocking");
  assert.equal(plan.event, "REQUEST_CHANGES");
  assert.equal(plan.shouldPublish, true);
  assert.equal(plan.selectedPreviewIds[0], "preview-1");
});

test("buildReviewPublicationPlan approves after a prior blocking review is cleared", () => {
  const plan = buildReviewPublicationPlan({
    repoId: "acme/demo",
    prNumber: 42,
    findings: [],
    commentCandidates: [],
    commentPreviews: [],
    latestPublishedReviewEvent: "REQUEST_CHANGES",
    delta: {
      newFindings: 0,
      resolvedFindings: 2,
      persistentFindings: 0,
    },
  });

  assert.equal(plan.reviewOutcome, "clean");
  assert.equal(plan.event, "APPROVE");
  assert.equal(plan.shouldPublish, true);
});

test("buildReviewPublicationPlan comments for non-blocking findings when no prior block exists", () => {
  const plan = buildReviewPublicationPlan({
    repoId: "acme/demo",
    prNumber: 42,
    findings: [
      {
        path: "src/demo.ts",
        lineStart: 20,
        severity: "medium",
        source: "biome",
        title: "Use const",
        explanation: "Prefer const.",
      },
    ],
    commentCandidates: [
      {
        path: "src/demo.ts",
        lineStart: 20,
        severity: "medium",
        source: "biome",
        isPublishable: false,
        reason: "summary_only",
      },
    ],
    commentPreviews: [],
    latestPublishedReviewEvent: null,
  });

  assert.equal(plan.reviewOutcome, "comment_only");
  assert.equal(plan.event, "COMMENT");
  assert.equal(plan.shouldPublish, true);
});
