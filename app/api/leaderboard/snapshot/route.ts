import { runLeaderboardSnapshot } from "@/lib/leaderboard/service";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const expectedSecret = process.env.LEADERBOARD_SNAPSHOT_SECRET;
  if (expectedSecret) {
    const providedSecret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (providedSecret !== expectedSecret) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const payload = await runLeaderboardSnapshot();

  return Response.json(payload, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
