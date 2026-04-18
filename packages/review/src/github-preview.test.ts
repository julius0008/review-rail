import test from "node:test";
import assert from "node:assert/strict";
import { buildGitHubReviewPreviews } from "./github-preview";

test("buildGitHubReviewPreviews keeps comments on patch lines valid", () => {
  const previews = buildGitHubReviewPreviews({
    headSha: "abc123",
    changedFiles: [
      {
        path: "src/demo.ts",
        patch: "@@ -1,2 +1,3 @@\n const a = 1;\n+const b = 2;\n export { a, b };",
      },
    ],
    candidates: [
      {
        id: "candidate-1",
        path: "src/demo.ts",
        lineStart: 2,
        body: "test",
        severity: "high",
        source: "semgrep",
        isPublishable: true,
        reason: "publishable_high_signal",
      },
    ],
  });

  assert.equal(previews[0]?.isValid, true);
  assert.equal(previews[0]?.line, 2);
});

test("buildGitHubReviewPreviews rejects comments outside the patch", () => {
  const previews = buildGitHubReviewPreviews({
    headSha: "abc123",
    changedFiles: [
      {
        path: "src/demo.ts",
        patch: "@@ -1,1 +1,1 @@\n-const a = 1;\n+const a = 2;",
      },
    ],
    candidates: [
      {
        id: "candidate-2",
        path: "src/demo.ts",
        lineStart: 20,
        body: "test",
        severity: "high",
        source: "semgrep",
        isPublishable: true,
        reason: "publishable_high_signal",
      },
    ],
  });

  assert.equal(previews[0]?.isValid, false);
  assert.equal(previews[0]?.skipReason, "line_not_in_patch");
});
