import { getYieldDashboardData } from "@/lib/yield-sources";

export const runtime = "nodejs";

export async function GET() {
  const payload = await getYieldDashboardData();

  return Response.json(payload, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
