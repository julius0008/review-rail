import path from "node:path";
import { spawn } from "node:child_process";

const runtime =
  (process.env.APP_RUNTIME ??
    process.env.SERVICE_ROLE ??
    process.env.OBSERVER_RUNTIME ??
    "web")
    .trim()
    .toLowerCase();

const root = process.cwd();
const tsxBinary = path.resolve(root, "node_modules/.bin/tsx");

const commands = {
  web: {
    file: path.resolve(root, "apps/web/scripts/start-render.ts"),
  },
  worker: {
    file: path.resolve(root, "apps/worker/src/index.ts"),
  },
};

const selected = commands[runtime];

if (!selected) {
  console.error(
    `[observer.runtime] Unknown APP_RUNTIME="${runtime}". Expected "web" or "worker".`
  );
  process.exit(1);
}

console.log(`[observer.runtime] Starting ${runtime} runtime`);

const child = spawn(tsxBinary, [selected.file], {
  env: process.env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(`[observer.runtime] Failed to launch ${runtime} runtime:`, error);
  process.exit(1);
});
