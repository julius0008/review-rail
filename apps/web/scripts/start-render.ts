import path from "node:path";
import { spawn } from "node:child_process";
import { getAppConfig, logEvent } from "@repo/shared";

const config = getAppConfig();
const port = process.env.PORT ?? "10000";

logEvent("web.start", "info", "Starting web service", {
  nodeEnv: process.env.NODE_ENV ?? "development",
  appUrl: config.appUrl,
  port,
  llmEnabled: config.llm.enabled,
  llmProvider: config.llm.provider,
  autoPublish: config.reviewRail.autoPublish,
  blockingMode: config.reviewRail.blockingMode,
});

if (config.llm.enabled) {
  logEvent("web.start", "info", "LLM augmentation enabled", {
    provider: config.llm.provider,
    model: config.llm.ollama.model,
    timeoutMs: config.llm.timeoutMs,
  });
} else {
  logEvent(
    "web.start",
    "info",
    "LLM augmentation disabled; deterministic analyzers remain the production baseline",
    {
      ollamaConfigIgnored: Boolean(
        process.env.OLLAMA_BASE_URL || process.env.OLLAMA_MODEL
      ),
    }
  );
}

const nextBinary = path.resolve(process.cwd(), "node_modules/.bin/next");

const child = spawn(
  nextBinary,
  ["start", "--hostname", "0.0.0.0", "--port", port],
  {
    env: process.env,
    stdio: "inherit",
  }
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on("error", (error) => {
  logEvent("web.start", "error", "Failed to launch Next.js server", {
    error: error.message,
  });
  process.exit(1);
});
