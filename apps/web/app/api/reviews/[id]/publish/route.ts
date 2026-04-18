import { publishReviewRunToGitHub } from "@repo/providers";

type Props = {
  params: Promise<{ id: string }>;
};

export async function POST(_: Request, { params }: Props) {
  const { id } = await params;
  const result = await publishReviewRunToGitHub({
    reviewRunId: id,
    trigger: "manual",
  });

  if (!result.ok) {
    return Response.json(
      {
        ok: false,
        skipped: result.skipped,
        reason: "reason" in result ? result.reason : undefined,
        error: result.error,
      },
      { status: result.status }
    );
  }

  return Response.json(result);
}
