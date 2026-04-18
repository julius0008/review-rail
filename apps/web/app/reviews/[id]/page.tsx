import { notFound } from "next/navigation";
import { ReviewRunDetailLive } from "@/components/review-run-detail-live";
import { getReviewRunDetailSnapshot } from "@/lib/review-run-snapshots";

type Props = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";

export default async function ReviewDetailsPage({ params }: Props) {
  const { id } = await params;
  const snapshot = await getReviewRunDetailSnapshot(id);

  if (!snapshot) {
    notFound();
  }

  return <ReviewRunDetailLive initialSnapshot={snapshot} />;
}
