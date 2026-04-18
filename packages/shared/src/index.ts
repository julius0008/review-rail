import { z } from "zod";

export const reviewJobSchema = z.object({
  provider: z.literal("github"),
  reviewRunId: z.string(),
  installationId: z.number().int().positive(),
  owner: z.string(),
  repo: z.string(),
  repoId: z.string(),
  prNumber: z.number().int().positive(),
  headSha: z.string(),
  baseSha: z.string().optional(),
});

export type ReviewJob = z.infer<typeof reviewJobSchema>;

export const reviewRunStageSchema = z.enum([
  "queued",
  "fetching",
  "analyzing",
  "postprocessing",
  "llm_pending",
  "llm_completed",
  "publish_ready",
  "completed",
  "failed",
  "stale",
]);

export type ReviewRunStage = z.infer<typeof reviewRunStageSchema>;

export const terminalReviewRunStages = new Set<ReviewRunStage>([
  "publish_ready",
  "completed",
  "failed",
  "stale",
]);

export const llmReviewStatusSchema = z.enum([
  "disabled",
  "pending",
  "running",
  "completed",
  "skipped",
  "failed",
]);

export type LlmReviewStatus = z.infer<typeof llmReviewStatusSchema>;

export const publishStateSchema = z.enum([
  "idle",
  "publishing",
  "published",
  "failed",
]);

export type PublishState = z.infer<typeof publishStateSchema>;

export const reviewRunEventTypeSchema = z.enum([
  "connected",
  "run_created",
  "run_updated",
  "heartbeat",
]);

export type ReviewRunEventType = z.infer<typeof reviewRunEventTypeSchema>;

export const reviewRunEventSchema = z.object({
  type: reviewRunEventTypeSchema,
  reviewRunId: z.string(),
  repoId: z.string().optional(),
  prNumber: z.number().int().positive().optional(),
  status: reviewRunStageSchema.optional(),
  llmStatus: llmReviewStatusSchema.optional(),
  publishState: publishStateSchema.optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type ReviewRunEvent = z.infer<typeof reviewRunEventSchema>;

export const REVIEW_RUN_EVENTS_CHANNEL = "review-run-events";

export function getReviewRunEventsChannel(reviewRunId: string) {
  return `${REVIEW_RUN_EVENTS_CHANNEL}:${reviewRunId}`;
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value == null || value === "") return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

function parseNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().optional(),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  GITHUB_APP_ID: z.string().min(1, "GITHUB_APP_ID is required"),
  GITHUB_APP_PRIVATE_KEY: z
    .string()
    .min(1, "GITHUB_APP_PRIVATE_KEY is required"),
  GITHUB_WEBHOOK_SECRET: z
    .string()
    .min(1, "GITHUB_WEBHOOK_SECRET is required"),
  ENABLE_LLM_REVIEW: z.string().optional(),
  LLM_ENABLED: z.string().optional(),
  LLM_PROVIDER: z.string().optional(),
  OLLAMA_BASE_URL: z.string().url().optional(),
  OLLAMA_MODEL: z.string().optional(),
  LLM_TIMEOUT_MS: z.string().optional(),
  LLM_MAX_FILES: z.string().optional(),
  LLM_MAX_FINDINGS: z.string().optional(),
  LLM_MAX_SNIPPETS: z.string().optional(),
  LLM_MAX_SNIPPET_LINES: z.string().optional(),
  LLM_CONFIDENCE_THRESHOLD: z.string().optional(),
  DEBUG_LLM_UI: z.string().optional(),
});

export type AppConfig = {
  appUrl?: string;
  databaseUrl: string;
  redisUrl: string;
  github: {
    appId: number;
    privateKey: string;
    webhookSecret: string;
  };
  llm: {
    enabled: boolean;
    provider: "ollama";
    timeoutMs: number;
    confidenceThreshold: number;
    budgets: {
      maxFiles: number;
      maxFindingsPerFile: number;
      maxSnippets: number;
      maxSnippetLines: number;
    };
    ollama: {
      baseUrl: string;
      model: string;
    };
  };
  debug: {
    llmUi: boolean;
  };
};

let cachedConfig: AppConfig | null = null;

export function getAppConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;

  const env = envSchema.parse(process.env);
  const llmEnabled = parseBoolean(
    env.ENABLE_LLM_REVIEW ?? env.LLM_ENABLED,
    false
  );
  const llmProvider = env.LLM_PROVIDER ?? "ollama";

  if (env.NODE_ENV === "production" && !env.APP_URL) {
    throw new Error(
      "APP_URL is required in production so webhook publishing and deployment URLs stay explicit."
    );
  }

  if (llmEnabled && llmProvider !== "ollama") {
    throw new Error(
      `Unsupported LLM_PROVIDER "${llmProvider}". Only "ollama" is currently supported.`
    );
  }

  cachedConfig = {
    appUrl: env.APP_URL,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    github: {
      appId: Number(env.GITHUB_APP_ID),
      privateKey: env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n"),
      webhookSecret: env.GITHUB_WEBHOOK_SECRET,
    },
    llm: {
      enabled: llmEnabled,
      provider: "ollama",
      timeoutMs: parseNumber(env.LLM_TIMEOUT_MS, 15_000),
      confidenceThreshold: parseNumber(env.LLM_CONFIDENCE_THRESHOLD, 0.78),
      budgets: {
        maxFiles: parseNumber(env.LLM_MAX_FILES, 2),
        maxFindingsPerFile: parseNumber(env.LLM_MAX_FINDINGS, 2),
        maxSnippets: parseNumber(env.LLM_MAX_SNIPPETS, 4),
        maxSnippetLines: parseNumber(env.LLM_MAX_SNIPPET_LINES, 24),
      },
      ollama: {
        baseUrl: env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
        model: env.OLLAMA_MODEL ?? "qwen2.5-coder:7b",
      },
    },
    debug: {
      llmUi: parseBoolean(env.DEBUG_LLM_UI, false),
    },
  };

  return cachedConfig;
}

export type LogLevel = "info" | "warn" | "error";

export function logEvent(
  scope: string,
  level: LogLevel,
  message: string,
  data?: Record<string, unknown>
) {
  const payload = {
    ts: new Date().toISOString(),
    scope,
    level,
    message,
    ...(data ?? {}),
  };

  const line = JSON.stringify(payload);

  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.log(line);
}
