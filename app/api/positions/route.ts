import { getPositionsDashboardData } from "@/lib/yield-positions";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const address = url.searchParams.get("address") ?? "";
  const payload = await getPositionsDashboardData(address);

  return Response.json(payload, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
