import test from "node:test";
import assert from "node:assert/strict";
import { buildAnalysisPlan, buildCoverageSummary } from "./coverage";

test("buildAnalysisPlan keeps full coverage when files fit within budget", () => {
  const plan = buildAnalysisPlan(
    [
      { path: "src/a.ts", status: "modified", changes: 20 },
      { path: "src/b.ts", status: "modified", changes: 10 },
    ],
    {
      maxAnalyzedFiles: 10,
      maxChangedLines: 1000,
    }
  );

  assert.equal(plan.coverage.mode, "full");
  assert.equal(plan.coverage.analyzedFileCount, 2);
  assert.equal(plan.coverage.skippedFileCount, 0);
  assert.equal(
    buildCoverageSummary(plan.coverage),
    "Observer analyzed all 2 analyzable files."
  );
});

test("buildAnalysisPlan soft-caps by changed line budget", () => {
  const plan = buildAnalysisPlan(
    [
      { path: "src/large.ts", status: "modified", changes: 1200 },
      { path: "src/medium.ts", status: "modified", changes: 900 },
      { path: "src/small.ts", status: "modified", changes: 300 },
    ],
    {
      maxAnalyzedFiles: 10,
      maxChangedLines: 1500,
    }
  );

  assert.equal(plan.coverage.mode, "partial");
  assert.equal(plan.coverage.reason, "line_budget");
  assert.equal(plan.coverage.analyzedFileCount, 2);
  assert.equal(plan.coverage.skippedFileCount, 1);
  assert.deepEqual(plan.coverage.skippedPaths, ["src/medium.ts"]);
});

test("buildAnalysisPlan soft-caps by file count budget", () => {
  const plan = buildAnalysisPlan(
    [
      { path: "src/a.ts", status: "modified", changes: 50 },
      { path: "src/b.ts", status: "modified", changes: 40 },
      { path: "src/c.ts", status: "modified", changes: 30 },
    ],
    {
      maxAnalyzedFiles: 2,
      maxChangedLines: 1000,
    }
  );

  assert.equal(plan.coverage.mode, "partial");
  assert.equal(plan.coverage.reason, "file_budget");
  assert.equal(plan.coverage.analyzedFileCount, 2);
  assert.equal(plan.coverage.skippedFileCount, 1);
  assert.deepEqual(plan.coverage.skippedPaths, ["src/c.ts"]);
});
