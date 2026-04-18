import { getInstallationOctokit } from "./github";

type ReviewCommentInput = {
  path: string;
  body: string;
  line: number;
  side: "RIGHT" | "LEFT";
  start_line?: number | null;
  start_side?: "RIGHT" | "LEFT" | null;
};

export async function publishPullRequestReview(input: {
  installationId: number;
  owner: string;
  repo: string;
  pullNumber: number;
  commitId: string;
  body: string;
  comments: ReviewCommentInput[];
}) {
  const octokit = getInstallationOctokit(input.installationId);

  const { data } = await octokit.request(
    "POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
    {
      owner: input.owner,
      repo: input.repo,
      pull_number: input.pullNumber,
      commit_id: input.commitId,
      body: input.body,
      event: "COMMENT",
      comments: input.comments.map((comment) => ({
        path: comment.path,
        body: comment.body,
        line: comment.line,
        side: comment.side,
        ...(comment.start_line ? { start_line: comment.start_line } : {}),
        ...(comment.start_side ? { start_side: comment.start_side } : {}),
      })),
      headers: {
        accept: "application/vnd.github+json",
      },
    }
  );

  return data;
}
