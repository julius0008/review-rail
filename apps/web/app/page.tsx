export const dynamic = "force-dynamic";

import { DashboardLive } from "@/components/dashboard-live";
import { getDashboardRunsSnapshot } from "@/lib/review-run-snapshots";

export default async function HomePage() {
  const snapshot = await getDashboardRunsSnapshot();

  return <DashboardLive initialSnapshot={snapshot} />;
}
