import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";


const execFileAsync = promisify(execFile);

type InputFile = {
  path: string;
  content: string;
};

export type AnalyzerFinding = {
  path: string;
  lineStart: number;
  lineEnd?: number;
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

const SUPPORTED_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);

function isSupported(pathname: string) {
  return SUPPORTED_EXTENSIONS.has(path.extname(pathname));
}

function mapLevel(level?: string) {
  if (level === "error") return "high";
  if (level === "warning" || level === "warn") return "medium";
  return "low";
}

export async function runBiomeAnalysis(files: InputFile[]): Promise<AnalyzerFinding[]> {
  const lintableFiles = files.filter((file) => isSupported(file.path));

  if (lintableFiles.length === 0) {
    return [];
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "review-biome-"));

  try {
    for (const file of lintableFiles) {
      const absolutePath = path.join(tempRoot, file.path);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, file.content, "utf8");
    }

    const absoluteFilePaths = lintableFiles.map((file) => path.join(tempRoot, file.path));

    const { stdout } = await execFileAsync(
      "pnpm",
      ["exec", "biome", "lint", "--reporter=sarif", ...absoluteFilePaths],
      {
        cwd: process.cwd(),
        env: process.env,
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    const sarif = JSON.parse(stdout);
    const results = sarif?.runs?.[0]?.results ?? [];

    return results.map((result: any) => {
      const location = result.locations?.[0]?.physicalLocation;
      const region = location?.region;
      const artifactUri = location?.artifactLocation?.uri ?? "";
      const relativePath = path.relative(tempRoot, artifactUri);

      const ruleId = result.ruleId ?? null;
      const message =
        result.message?.text ??
        result.message?.markdown ??
        "Biome reported a lint issue";

      return {
        path: relativePath,
        lineStart: region?.startLine ?? 1,
        lineEnd: region?.endLine ?? null,
        category: "style",
        severity: mapLevel(result.level),
        confidence: 0.95,
        title: ruleId ? `Biome: ${ruleId}` : "Biome lint issue",
        explanation: message,
        actionableFix: null,
        source: "biome",
        ruleId,
        publish: false,
      };
    });
  } catch (error: any) {
    if (typeof error?.stdout === "string" && error.stdout.trim()) {
      const sarif = JSON.parse(error.stdout);
      const results = sarif?.runs?.[0]?.results ?? [];

      return results.map((result: any) => {
        const location = result.locations?.[0]?.physicalLocation;
        const region = location?.region;
        const artifactUri = location?.artifactLocation?.uri ?? "";
        const relativePath = path.relative(tempRoot, artifactUri);

        const ruleId = result.ruleId ?? null;
        const message =
          result.message?.text ??
          result.message?.markdown ??
          "Biome reported a lint issue";

        return {
          path: relativePath,
          lineStart: region?.startLine ?? 1,
          lineEnd: region?.endLine ?? null,
          category: "style",
          severity: mapLevel(result.level),
          confidence: 0.95,
          title: ruleId ? `Biome: ${ruleId}` : "Biome lint issue",
          explanation: message,
          actionableFix: null,
          source: "biome",
          ruleId,
          publish: false,
        };
      });
    }

    throw error;
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}