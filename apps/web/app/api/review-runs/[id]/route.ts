import { getReviewRunDetailSnapshot } from "@/lib/review-run-snapshots";

type Props = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: Props) {
  const { id } = await params;
  const snapshot = await getReviewRunDetailSnapshot(id);

  if (!snapshot) {
    return Response.json(
      { ok: false, error: "Review run not found" },
      { status: 404 }
    );
  }

  return Response.json(snapshot);
}
