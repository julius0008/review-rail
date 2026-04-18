import crypto from "node:crypto";
import { Octokit } from "octokit";
import { createAppAuth } from "@octokit/auth-app";
import { getAppConfig } from "@repo/shared";

export function verifyGitHubWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader) return false;

  const secret = getAppConfig().github.webhookSecret;
  const expected = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex")}`;

  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(signatureHeader);

  if (expectedBuffer.length !== receivedBuffer.length) return false;

  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

export function getInstallationOctokit(installationId: number) {
  const config = getAppConfig();

  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: config.github.appId,
      privateKey: config.github.privateKey,
      installationId,
    },
  });
}

export type PullRequestSnapshot = {
  repoId: string;
  prNumber: number;
  title: string;
  baseSha: string;
  headSha: string;
  files: Array<{
    path: string;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
    patch: string | null;
  }>;
};

export async function fetchPullRequestSnapshot(input: {
  installationId: number;
  owner: string;
  repo: string;
  prNumber: number;
}): Promise<PullRequestSnapshot> {
  const octokit = getInstallationOctokit(input.installationId);

  const { data: pr } = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
    owner: input.owner,
    repo: input.repo,
    pull_number: input.prNumber,
  });

  const files: PullRequestSnapshot["files"] = [];
  let page = 1;

  while (true) {
    const { data } = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}/files", {
      owner: input.owner,
      repo: input.repo,
      pull_number: input.prNumber,
      per_page: 100,
      page,
    });

    files.push(
      ...data.map((file) => ({
        path: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
        patch: file.patch ?? null,
      }))
    );

    if (data.length < 100) break;
    page += 1;
  }

  return {
    repoId: `${input.owner}/${input.repo}`,
    prNumber: pr.number,
    title: pr.title,
    baseSha: pr.base.sha,
    headSha: pr.head.sha,
    files,
  };
}

export async function fetchRepositoryFileContent(input: {
  installationId: number;
  owner: string;
  repo: string;
  path: string;
  ref: string;
}): Promise<string | null> {
  const octokit = getInstallationOctokit(input.installationId);

  try {
    const { data } = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
      owner: input.owner,
      repo: input.repo,
      path: input.path,
      ref: input.ref,
      headers: {
        accept: "application/vnd.github.object+json",
      },
    });

    if (!("content" in data) || typeof data.content !== "string") {
      return null;
    }

    return Buffer.from(data.content, "base64").toString("utf8");
  } catch {
    return null;
  }
}
