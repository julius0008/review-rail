import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

type InputFile = {
  path: string;
  content: string;
};

export type AnalyzerFinding = {
  path: string;
  lineStart: number;
  lineEnd?: number | null;
  category: string;
  severity: string;
  confidence: number;
  title: string;
  explanation: string;
  actionableFix?: string | null;
  source: string;
  ruleId?: string | null;
  publish: boolean;
};

function mapSeverity(severity?: string) {
  if (severity === "ERROR") return "high";
  if (severity === "WARNING") return "medium";
  return "low";
}

function normalizeResultPath(rawPath: string) {
  return rawPath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function parseSemgrepJson(stdout: string): AnalyzerFinding[] {
  const parsed = JSON.parse(stdout);
  const results = parsed.results ?? [];

  return results.map((result: any) => ({
    path: normalizeResultPath(result.path),
    lineStart: result.start?.line ?? 1,
    lineEnd: result.end?.line ?? null,
    category: "security",
    severity: mapSeverity(result.extra?.severity),
    confidence: 0.9,
    title: result.check_id ?? "Semgrep finding",
    explanation: result.extra?.message ?? "Semgrep reported a finding",
    actionableFix: null,
    source: "semgrep",
    ruleId: result.check_id ?? null,
    publish: false,
  }));
}

function getSemgrepConfigPath() {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = path.dirname(currentFile);

  // packages/analysis/src/semgrep.ts -> repoRoot/semgrep/review-rules.yml
  return path.resolve(currentDir, "../../../semgrep/review-rules.yml");
}

export async function runSemgrepAnalysis(
  files: InputFile[]
): Promise<AnalyzerFinding[]> {
  if (files.length === 0) {
    return [];
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "review-semgrep-"));

  try {
    for (const file of files) {
      const absolutePath = path.join(tempRoot, file.path);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, file.content, "utf8");
    }

    const semgrepConfigPath = getSemgrepConfigPath();

    const { stdout } = await execFileAsync(
      "semgrep",
      [
        "scan",
        "--config",
        semgrepConfigPath,
        "--json",
        ".",
      ],
      {
        cwd: tempRoot,
        env: process.env,
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    return parseSemgrepJson(stdout);
  } catch (error: any) {
    if (typeof error?.stdout === "string" && error.stdout.trim()) {
      return parseSemgrepJson(error.stdout);
    }

    throw error;
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}