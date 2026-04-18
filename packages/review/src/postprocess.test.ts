import test from "node:test";
import assert from "node:assert/strict";
import { processFindings } from "./postprocess";

test("processFindings prefers the higher-signal duplicate finding", () => {
  const findings = processFindings([
    {
      path: "src/example.ts",
      lineStart: 12,
      category: "style",
      severity: "warning",
      confidence: 0.8,
      title: "Avoid eval()",
      explanation: "Avoid eval usage.",
      source: "biome",
      ruleId: "lint.security.noEval",
      publish: false,
    },
    {
      path: "src/example.ts",
      lineStart: 12,
      category: "security",
      severity: "high",
      confidence: 0.9,
      title: "Avoid eval()",
      explanation: "Avoid eval usage.",
      source: "semgrep",
      ruleId: "security.no-eval",
      publish: false,
    },
  ]);

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.source, "semgrep");
  assert.equal(findings[0]?.severity, "high");
});
