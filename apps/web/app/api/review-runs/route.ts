import { getDashboardRunsSnapshot } from "@/lib/review-run-snapshots";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await getDashboardRunsSnapshot());
}
