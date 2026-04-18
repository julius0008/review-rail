import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const configDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  transpilePackages: [
    "@repo/shared",
    "@repo/queue",
    "@repo/db",
    "@repo/providers",
    "@repo/review",
    "@repo/analysis",
  ],
  turbopack: {
    root: path.resolve(configDir, "../.."),
  },
};

export default nextConfig;
