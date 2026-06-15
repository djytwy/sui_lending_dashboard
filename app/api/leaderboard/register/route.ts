import { registerLeaderboardWallet } from "@/lib/leaderboard/service";
import type { RegisterLeaderboardWalletInput } from "@/lib/leaderboard/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const input = (await request.json()) as RegisterLeaderboardWalletInput;
  const payload = await registerLeaderboardWallet(input);

  return Response.json(payload, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
