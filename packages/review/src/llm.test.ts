import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://example";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.GITHUB_APP_ID ??= "1";
process.env.GITHUB_APP_PRIVATE_KEY ??= "-----BEGIN PRIVATE KEY-----\\nTEST\\n-----END PRIVATE KEY-----";
process.env.GITHUB_WEBHOOK_SECRET ??= "test";
process.env.ENABLE_LLM_REVIEW ??= "true";
process.env.LLM_MAX_FILES ??= "1";
process.env.LLM_MAX_FINDINGS ??= "1";
process.env.LLM_MAX_SNIPPETS ??= "2";
process.env.LLM_MAX_SNIPPET_LINES ??= "12";

import {
  buildLlmReviewContextBundles,
  type ParsedLlmResponse,
  mergeLlmFindings,
  parseLlmReviewResponse,
} from "./llm";

test("buildLlmReviewContextBundles limits context to the highest-risk file", () => {
  const bundles = buildLlmReviewContextBundles({
    changedFiles: [
      {
        path: "src/high-risk.ts",
        status: "modified",
        additions: 10,
        deletions: 1,
        changes: 11,
        patch: "@@ -9,1 +9,2 @@\n const a = 1;\n+danger();",
      },
      {
        path: "src/low-risk.ts",
        status: "modified",
        additions: 1,
        deletions: 0,
        changes: 1,
        patch: "@@ -1,1 +1,1 @@\n-const a = 1;\n+const a = 2;",
      },
    ],
    fileContents: [
      {
        path: "src/high-risk.ts",
        content: Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join("\n"),
      },
      {
        path: "src/low-risk.ts",
        content: "const a = 2;",
      },
    ],
    deterministicFindings: [
      {
        path: "src/high-risk.ts",
        lineStart: 10,
        category: "security",
        severity: "high",
        confidence: 0.95,
        title: "Dangerous pattern",
        explanation: "High-signal finding",
        source: "semgrep",
        ruleId: "security.rule",
        publish: false,
      },
    ],
  });

  assert.equal(bundles.length, 1);
  assert.equal(bundles[0]?.path, "src/high-risk.ts");
  assert.ok((bundles[0]?.snippets.length ?? 0) <= 2);
});

test("parseLlmReviewResponse extracts structured JSON from fenced output", () => {
  const parsed = parseLlmReviewResponse(`\`\`\`json
  {"findings":[{"path":"src/demo.ts","lineStart":8,"title":"Null check missing","explanation":"Guard undefined before access","severity":"medium","confidence":0.91,"publishable":true}]}
  \`\`\``);

  assert.equal(parsed.findings.length, 1);
  assert.equal(parsed.findings[0]?.title, "Null check missing");
  assert.equal(parsed.diagnostics.rawFindingCount, 1);
});

test("parseLlmReviewResponse coerces common local-model formatting issues", () => {
  const parsed = parseLlmReviewResponse(JSON.stringify({
    findings: [
      {
        file: "src/demo.ts",
        line: "8",
        issue: "Null check missing",
        description: "Guard undefined before access",
        level: "warn",
        confidence: "91",
      },
      {
        path: "src/demo.ts",
        lineStart: 12,
        title: "Broken finding",
        explanation: "Missing severity should be dropped",
        confidence: "0.44",
        publishable: "false",
      },
    ],
  }));

  assert.equal(parsed.findings.length, 1);
  assert.equal(parsed.findings[0]?.lineStart, 8);
  assert.equal(parsed.findings[0]?.confidence, 0.91);
  assert.equal(parsed.findings[0]?.publishable, false);
  assert.equal(parsed.diagnostics.invalidShapeCount, 1);
  assert.equal(parsed.findings[0]?.severity, "medium");
  assert.equal(parsed.findings[0]?.path, "src/demo.ts");
});

test("parseLlmReviewResponse maps qualitative confidence labels", () => {
  const parsed = parseLlmReviewResponse(JSON.stringify({
    findings: [
      {
        path: "src/demo.ts",
        lineStart: 5,
        title: "Logic bug",
        explanation: "Condition is inverted",
        severity: "High",
        confidence: "High",
        publishable: true,
      },
    ],
  }));

  assert.equal(parsed.findings.length, 1);
  assert.equal(parsed.findings[0]?.confidence, 0.9);
  assert.equal(parsed.findings[0]?.severity, "high");
});

test("mergeLlmFindings drops overlapping deterministic findings", () => {
  const merged = mergeLlmFindings({
    parsed: {
      findings: [
        {
          path: "src/demo.ts",
          lineStart: 8,
          title: "Null check missing",
          explanation: "Guard undefined before access",
          severity: "medium",
          confidence: 0.95,
          publishable: true,
        },
      ],
      summary: "one finding",
      diagnostics: {
        rawFindingCount: 1,
        invalidShapeCount: 0,
        parsedFindingCount: 1,
      },
    },
    deterministicFindings: [
      {
        path: "src/demo.ts",
        lineStart: 8,
        category: "correctness",
        severity: "medium",
        confidence: 0.9,
        title: "Null check missing",
        explanation: "Guard undefined before access",
        source: "semgrep",
        ruleId: "correctness.null-check",
        publish: false,
      },
    ],
  });

  assert.equal(merged.findings.length, 0);
  assert.equal(merged.diagnostics.overlappingCount, 1);
});

test("mergeLlmFindings reports drop reasons and accepted counts", () => {
  const parsed: ParsedLlmResponse = {
    findings: [
      {
        path: "src/demo.ts",
        lineStart: 10,
        title: "Strong finding",
        explanation: "Accepted finding",
        severity: "high",
        confidence: 0.92,
        publishable: true,
      },
      {
        path: "src/demo.ts",
        lineStart: 20,
        title: "Weak finding",
        explanation: "Low confidence",
        severity: "medium",
        confidence: 0.2,
        publishable: false,
      },
    ],
    diagnostics: {
      rawFindingCount: 3,
      invalidShapeCount: 1,
      parsedFindingCount: 2,
    },
  };

  const merged = mergeLlmFindings({
    parsed,
    deterministicFindings: [],
  });

  assert.equal(merged.findings.length, 1);
  assert.equal(merged.diagnostics.rawFindingCount, 3);
  assert.equal(merged.diagnostics.invalidShapeCount, 1);
  assert.equal(merged.diagnostics.belowConfidenceCount, 1);
  assert.equal(merged.diagnostics.acceptedFindingCount, 1);
});
