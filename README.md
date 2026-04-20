# Observer

Queue-backed GitHub pull request review assistant built with Next.js, TypeScript, Prisma, Redis, BullMQ, a separate worker process, and deterministic analyzers first.

## What It Does

- Ingests GitHub App pull request webhooks with delivery dedupe
- Creates review runs keyed by `repo + PR + head SHA`
- Snapshots changed files and patches
- Runs Biome and Semgrep as the primary review engine
- Normalizes, deduplicates, scores, and prioritizes findings
- Builds draft inline comment candidates and exact GitHub review payload previews
- Auto-publishes GitHub pull request reviews with safer publish-state locking
- Uses `REQUEST_CHANGES`, `COMMENT`, and `APPROVE` review events so Observer can block and later clear its own PR reviews
- Optionally adds a local-first Ollama review augmentation pass on top of deterministic results
- Streams live run creation and status updates to a PR-first dashboard and run detail pages with SSE + Redis pub/sub

## Architecture

Core flow:

`GitHub App webhook -> Next.js API -> BullMQ / Redis -> Worker -> PR snapshot -> Biome + Semgrep -> postprocessing -> preview generation -> optional Ollama enrichment -> auto-publish GitHub review`

Live UI flow:

`Webhook / worker / publish state change -> Redis pub/sub event -> SSE route -> browser EventSource -> JSON snapshot re-fetch`

Main packages:

- `apps/web`: dashboard, run detail UI, webhook ingestion, JSON snapshot APIs, SSE stream endpoints, publish API, health checks
- `apps/worker`: queue consumer and staged review orchestration
- `packages/db`: Prisma schema and client
- `packages/queue`: BullMQ queue, lazy Redis accessors, and Redis pub/sub event helpers
- `packages/providers`: GitHub App and Ollama provider integrations
- `packages/review`: finding normalization, publishability, summaries, payload previews, and LLM context/prompt/merge logic
- `packages/shared`: typed config, shared schemas, statuses, and structured logging helpers

## Hosted Runtime Roles

The shared deployment image can start either the web service or the worker.

- Set `APP_RUNTIME=web` for the public Next.js service
- Set `APP_RUNTIME=worker` for the BullMQ consumer

If `APP_RUNTIME` is unset, the image defaults to `web`.

## Runtime Model

### Reactive UI

The app server-renders the first page load, then upgrades the current-run dashboard and review detail pages to live views.

- The dashboard listens for new runs and run updates through Server-Sent Events
- The run detail page listens for updates for its specific `reviewRunId`
- SSE events are invalidation-only; the browser re-fetches canonical JSON snapshots after each event
- If SSE is unavailable, the UI falls back to lightweight polling
- Verbose LLM debug payloads stay out of the live JSON responses unless `DEBUG_LLM_UI=true`

### Deterministic baseline

The app is healthy and complete with LLM review disabled.

- Biome and Semgrep remain the primary review engine
- Deterministic analysis always runs first
- Runs become `publish_ready` or `completed` even when LLM review is disabled, skipped, or fails
- LLM output never replaces deterministic findings

### Optional Ollama augmentation

The first LLM provider is Ollama and it is intentionally optional.

- Enable it with `ENABLE_LLM_REVIEW=true`
- Configure the model with `OLLAMA_MODEL`
- The worker runs Ollama only after deterministic artifacts already exist
- Ollama failures, timeouts, missing models, or invalid JSON do not fail the run
- Low-confidence or overlapping LLM findings are suppressed

## Context Minimization Strategy

This is a first-class constraint in the codebase.

- Never send the full repository
- Never send the full PR by default
- Only inspect changed files already selected by the deterministic pipeline
- Rank files by deterministic signal and change size
- Limit the LLM pass to a tiny number of files and snippets
- Build snippets from changed hunks and nearby deterministic findings
- Include why each snippet was selected
- Explicitly note what context was excluded
- Keep confidence thresholds high for publishable LLM findings

Current default budgets:

- `LLM_MAX_FILES=2`
- `LLM_MAX_FINDINGS=2`
- `LLM_MAX_SNIPPETS=4`
- `LLM_MAX_SNIPPET_LINES=24`
- `LLM_CONFIDENCE_THRESHOLD=0.78`

Useful local debug flag:

- `DEBUG_LLM_UI=false` by default
- set `DEBUG_LLM_UI=true` only when you want raw bundle previews and parse-failure details on the review page

## Review Run Lifecycle

Run `status` values:

- `queued`
- `fetching`
- `analyzing`
- `postprocessing`
- `llm_pending`
- `publish_ready`
- `completed`
- `failed`
- `stale`

Separate state is tracked for:

- `llmStatus`: `disabled`, `pending`, `running`, `completed`, `skipped`, `failed`
- `publishState`: `idle`, `publishing`, `published`, `failed`

## Local Setup

### 1. Start infrastructure

```bash
docker compose up -d
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Configure environment

Copy `.env.example` into the env files you use locally and fill in your real GitHub App credentials.

Important:

- Do not commit real private keys or webhook secrets
- The tracked `apps/web/.env.local` and `apps/worker/.env` files are placeholders only
- `APP_URL` is required in production deployments
- `REVIEW_RAIL_AUTO_PUBLISH=true` enables automatic PR review publishing
- `REVIEW_RAIL_BLOCKING_MODE=high_signal` keeps merge blocking limited to high-signal findings
- `REVIEW_MAX_ANALYZED_FILES=40` caps deterministic file coverage for very large PRs
- `REVIEW_MAX_CHANGED_LINES=2500` caps deterministic changed-line coverage for very large PRs
- `REVIEW_ANALYSIS_BATCH_SIZE=10` keeps fetch and analysis work chunked so the worker can yield between batches
- `REVIEW_WORKER_LOCK_DURATION_MS=180000`, `REVIEW_WORKER_STALLED_INTERVAL_MS=60000`, and `REVIEW_WORKER_MAX_STALLED_COUNT=2` harden BullMQ for long-running PR jobs

### 4. Run database setup

```bash
pnpm --filter @repo/db exec prisma migrate dev --schema prisma/schema.prisma
pnpm --filter @repo/db exec prisma generate --schema prisma/schema.prisma
```

### 5. Run the app

```bash
pnpm dev:web
pnpm dev:worker
```

## Ollama Setup

Ollama is optional and intended for local development or self-hosted enrichment.

Example:

```bash
ollama serve
ollama pull qwen2.5-coder:7b
```

Then set:

```bash
ENABLE_LLM_REVIEW=true
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5-coder:7b
```

Optional local tuning:

```bash
LLM_TIMEOUT_MS=60000
LLM_CONFIDENCE_THRESHOLD=0.7
DEBUG_LLM_UI=true
```

If Ollama is unavailable, the app still works. The run keeps its deterministic findings and records the LLM stage as skipped or failed.

## Deployment Notes

- Production success must not depend on Ollama
- Treat Ollama as local-first, self-hosted, or optional async enrichment
- Keep `ENABLE_LLM_REVIEW=false` by default in hosted MVP deployments unless you control the inference environment
- `LLM_ENABLED` is supported as a deployment-friendly alias for `ENABLE_LLM_REVIEW`
- Keep `REVIEW_RAIL_AUTO_PUBLISH=true` unless you explicitly want preview-only behavior
- `REVIEW_RAIL_BLOCKING_MODE` currently supports `high_signal`
- Large pull requests are soft-capped by deterministic review budgets so the worker can finish reliably instead of stalling
- Partial reviews are clearly disclosed in GitHub and the UI, and they never auto-approve or clear a prior block
- Keep `DEBUG_LLM_UI=false` in production so raw LLM responses and parse details stay out of the normal operator UI
- Web and worker both need the same GitHub App credentials, database URL, and Redis URL
- For Upstash, use the TLS connection string or equivalent TLS-enabled Redis configuration for both web and worker
- `docker-compose.prod.yml` includes Postgres, Redis, web, worker, and Caddy
- `apps/web/next.config.ts` pins Turbopack workspace root to the repo root to reduce lockfile-root ambiguity
- Recent history is intentionally capped to the latest 12 terminal review runs per repo

## Testing And Verification

Useful commands:

```bash
pnpm -r typecheck
pnpm test
pnpm --filter web build
```

Current focused unit coverage targets:

- deterministic finding dedupe
- GitHub payload preview validity
- LLM context-budget selection
- structured LLM response parsing
- LLM overlap suppression against deterministic findings

## Known Limitations

- GitHub inline publishing is still single-line only
- There is no hosted LLM provider yet; the abstraction is prepared for it
- Observability is structured but still lightweight; there is no tracing backend yet
- There are still no end-to-end integration tests for the full webhook-to-publish flow
- The UI is production-leaning, but not yet a full multi-tenant operational console

## Render Deployment

This repo includes a Render Blueprint in [render.yaml](/Users/drey/ai-code-reviewer/render.yaml:1) and a dedicated Render image in [Dockerfile.render](/Users/drey/ai-code-reviewer/Dockerfile.render:1).

Recommended Render architecture:

- Web Service: Next.js app on a paid `starter` instance
- Background Worker: BullMQ worker on a paid `starter` instance
- Postgres: paid Render Postgres, `basic-256mb` minimum
- Key Value: paid Render Key Value, `starter` minimum with `noeviction`

Why this setup:

- Background workers are not available on free plans
- Free web services spin down, which is a poor fit for GitHub webhooks
- Free Key Value is non-persistent, which is a poor fit for BullMQ
- Free Postgres expires after 30 days and has no backups
- The worker requires `semgrep`, so Docker is the simplest reliable deployment path

### Render Setup Steps

1. Push the repo with `render.yaml` and `Dockerfile.render`.
2. In Render, create a new Blueprint from this repository.
3. Confirm it creates:
   - `review-rail-web`
   - `review-rail-worker`
   - `review-rail-db`
   - `review-rail-cache`
4. Enter the secret values when prompted:
   - `APP_URL`
   - `GITHUB_APP_ID`
   - `GITHUB_APP_PRIVATE_KEY`
   - `GITHUB_WEBHOOK_SECRET`
5. Let Render deploy the stack.
6. After the web service is live, update your GitHub App webhook URL to:
   - `https://<your-render-domain>/api/github/webhook`
7. Keep the GitHub webhook secret identical to `GITHUB_WEBHOOK_SECRET` in Render.

### Render Environment Variables

Set on both the web service and the worker:

```bash
NODE_ENV=production
APP_URL=https://<your-web-service>.onrender.com
DATABASE_URL=<from Render Postgres connectionString>
REDIS_URL=<from Render Key Value connectionString>
GITHUB_APP_ID=<your app id>
GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=<your webhook secret>
ENABLE_LLM_REVIEW=false
LLM_ENABLED=false
LLM_PROVIDER=ollama
DEBUG_LLM_UI=false
```

Optional LLM variables can stay unset in production. When LLM review is disabled, missing Ollama config is safe and expected.

### Prisma In Production

- Render should run `pnpm render:migrate` as the web service pre-deploy command
- This uses `prisma migrate deploy`
- Do not use `prisma migrate dev` in production

### Post-Deploy Checklist

- `/api/health` returns `db: up`, `redis: up`, `llm: disabled`
- The worker boots and logs that deterministic analyzers remain the production baseline
- A PR webhook creates a review run
- The worker processes the queue and advances run stages
- Deterministic findings appear with Ollama disabled
- GitHub publish works when valid inline payload previews exist

## Northflank Deployment

If you want a low-cost portfolio/demo deployment, the simplest hosted shape for this repo is:

- **Northflank** for runtime
  - `review-rail-web`
  - `review-rail-worker`
- **Neon** for Postgres
- **Upstash Redis** for BullMQ and live event pub/sub

This keeps the current architecture intact, avoids local setup during demos, and stays close to free while still feeling like a real hosted product.

### Why this setup works well

- Northflank can run separate **web** and **worker** services from the same repository
- The repo already has a deployment image in [Dockerfile.render](/Users/drey/ai-code-reviewer/Dockerfile.render:1) that installs `semgrep` and supports both startup paths
- Neon provides a free hosted Postgres tier
- Upstash provides a free hosted Redis tier that works well for small BullMQ demo traffic
- Ollama stays disabled by default, so the hosted app remains healthy without any local inference dependency

### Northflank Services

Create one Northflank project with two services:

1. **Web service**
   - Source: this GitHub repository
   - Build type: Dockerfile
   - Dockerfile path: `Dockerfile.render`
   - Public URL: enabled
   - Health check: `GET /api/health`
   - Start command:

   ```bash
   pnpm start:web:prod
   ```

2. **Worker service**
   - Source: same repository
   - Build type: same Dockerfile
   - Public URL: disabled
   - Long-running process
   - Start command:

   ```bash
   pnpm start:worker:prod
   ```

Recommended build command for both services:

```bash
pnpm build:deploy
```

Recommended migration command to run once after the first deployment, or as a dedicated release/predeploy step if you configure one in Northflank:

```bash
pnpm migrate:deploy
```

### Neon + Upstash

Use external managed services instead of hosting Postgres/Redis inside Northflank for a cheaper demo setup.

#### Neon

- Create one Neon project on the free tier
- Use the pooled Postgres connection string as `DATABASE_URL`
- Run Prisma migrations against that database before using the app for real demos

#### Upstash Redis

- Create one free Redis database
- Use the TLS Redis URL as `REDIS_URL`
- BullMQ and the live SSE/pubsub path both use the same Redis connection

### Northflank Environment Variables

Set these on both the web service and the worker:

```bash
NODE_ENV=production
APP_URL=https://<your-northflank-web-domain>
DATABASE_URL=<your Neon pooled connection string>
REDIS_URL=<your Upstash Redis connection string>
GITHUB_APP_ID=<your app id>
GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=<your webhook secret>
ENABLE_LLM_REVIEW=false
LLM_ENABLED=false
LLM_PROVIDER=ollama
DEBUG_LLM_UI=false
```

Leave these unset unless you intentionally add hosted Ollama later:

- `OLLAMA_BASE_URL`
- `OLLAMA_MODEL`
- `LLM_TIMEOUT_MS`
- `LLM_MAX_FILES`
- `LLM_MAX_FINDINGS`
- `LLM_MAX_SNIPPETS`
- `LLM_MAX_SNIPPET_LINES`
- `LLM_CONFIDENCE_THRESHOLD`

### GitHub App Webhook

After the Northflank web service is live, update the GitHub App webhook URL to:

```bash
https://<your-northflank-web-domain>/api/github/webhook
```

The webhook secret in GitHub App settings must exactly match `GITHUB_WEBHOOK_SECRET`.

### Northflank Post-Deploy Checklist

- `/api/health` returns `db: up`, `redis: up`, `llm: disabled`
- The worker logs that deterministic analyzers remain the baseline
- A PR webhook creates a new review run
- Run stages progress through `queued`, `fetching`, `analyzing`, `postprocessing`, and `publish_ready` or `completed`
- Deterministic findings appear with LLM disabled
- GitHub publish works when valid inline payload previews exist
- Old terminal review runs are pruned beyond the latest 12 per repo
