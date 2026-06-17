import Link from "next/link";
import { getLeaderboard } from "@/lib/leaderboard/service";
import Image from "next/image";

export const dynamic = "force-dynamic";

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

export default async function LeaderboardPage() {
  const leaderboard = await getLeaderboard(100);
  const latestSnapshot = leaderboard.latestSnapshot;
  const totalSnapshotPoints = leaderboard.entries.reduce((sum, item) => sum + item.lastSnapshotPoints, 0);
  const activeWallets = leaderboard.entries.filter((item) => item.lastSnapshotPoints > 0).length;

  return (
    <main className="min-h-screen bg-[#0b0d14] text-[#fdfdff]">
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(180deg,rgba(127,127,255,0.15)_0%,rgba(11,13,20,0)_30%),linear-gradient(90deg,rgba(159,255,191,0.06),rgba(75,216,255,0.06),rgba(255,234,75,0.04))]" />
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-size-[48px_48px] opacity-30" />

      <div className="relative mx-auto flex w-full max-w-8xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-[#373A4D]/70 pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid size-15 place-items-center overflow-hidden p-1.5">
              <Image
                alt="Sui Lending Dashboard icon"
                className="size-full object-contain"
                height={40}
                src="/icon.png"
                width={40}
              />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-white sm:text-3xl">Yield Points Leaderboard</h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <StatusPill label="Cadence" value="1 hour" tone="violet" />
            <StatusPill label="Scoring" value="1 USD = 1 point" tone="green" />
            <Link
              className="flex h-10 items-center rounded-lg border border-[#373A4D] bg-[#232534] px-3 text-sm font-semibold text-white transition hover:border-[#9FFFBF]"
              href="/"
            >
              Dashboard
            </Link>
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-3">
          <MetricCard label="Current snapshot points" value={formatNumber(totalSnapshotPoints)} detail="Sum of verified active positions" />
          <MetricCard label="Active wallets" value={formatNumber(activeWallets)} detail="Wallets with non-zero points this hour" />
          <MetricCard
            label="Last snapshot"
            value={latestSnapshot ? formatSnapshotTime(latestSnapshot.snapshotHour) : "--"}
            detail={latestSnapshot ? `Status: ${latestSnapshot.status}` : "No snapshot has been completed yet"}
          />
        </section>

        <section className="grid gap-4 lg:grid-cols-[0.78fr_0.22fr]">
          <div className="min-h-[700px] rounded-lg border border-[#373A4D] bg-[#151722]/95">
            <div className="flex flex-col gap-2 border-b border-[#373A4D] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-[#8585B8]">Ranked by lifetime points</p>
                <h2 className="text-xl font-semibold text-white">Leaderboard</h2>
              </div>
              {/* <p className="text-sm text-[#a8a8c7]">Snapshot = Scallop + Bluefin + NAVI + Suilend verified USD value.</p> */}
            </div>

            {leaderboard.entries.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[800px] table-fixed text-left">
                  <thead className="text-xs uppercase text-[#8585B8]">
                    <tr className="border-b border-[#373A4D]">
                      <th className="w-[80px] px-4 py-3 font-medium">Rank</th>
                      <th className="w-[180px] px-4 py-3 font-medium">Wallet</th>
                      <th className="w-[140px] px-4 py-3 text-right font-medium">Total</th>
                      {/* <th className="w-[140px] px-4 py-3 text-right font-medium">Last snapshot</th> */}
                      {/* <th className="w-[120px] px-4 py-3 text-right font-medium">Scallop</th>
                      <th className="w-[120px] px-4 py-3 text-right font-medium">Bluefin</th>
                      <th className="w-[120px] px-4 py-3 text-right font-medium">NAVI</th>
                      <th className="w-[120px] px-4 py-3 text-right font-medium">Suilend</th> */}
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.entries.map((entry) => (
                      <tr key={entry.address} className="border-b border-[#232534] last:border-b-0">
                        <td className="px-4 py-4">
                          <span className="inline-flex size-8 items-center justify-center rounded-md border border-[#373A4D] bg-[#1c1e2c] text-sm font-semibold text-white">
                            {entry.rank}
                          </span>
                        </td>
                        <td className="px-4 py-4 font-mono text-sm text-[#dfdfed]">{shortAddress(entry.address)}</td>
                        <td className="px-4 py-4 text-right font-semibold text-[#9FFFBF]">{formatNumber(entry.totalPoints)}</td>
                        {/* <td className="px-4 py-4 text-right font-semibold text-[#FFEA4B]">{formatNumber(entry.lastSnapshotPoints)}</td> */}
                        {/* <td className="px-4 py-4 text-right text-sm text-[#dfdfed]">{formatNumber(entry.protocolPoints.scallop)}</td>
                        <td className="px-4 py-4 text-right text-sm text-[#dfdfed]">{formatNumber(entry.protocolPoints.bluefin)}</td>
                        <td className="px-4 py-4 text-right text-sm text-[#dfdfed]">{formatNumber(entry.protocolPoints.navi)}</td>
                        <td className="px-4 py-4 text-right text-sm text-[#dfdfed]">{formatNumber(entry.protocolPoints.suilend)}</td> */}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-4 text-sm text-[#a8a8c7] text-center">
                No leaderboard entries yet. Wallets are registered after a dashboard deposit, then scored by the hourly snapshot job.
              </div>
            )}
          </div>

          <aside className="rounded-lg border border-[#373A4D] bg-[#151722]/95 p-4">
            <p className="text-sm text-[#8585B8]">Scoring rule</p>
            <h2 className="mt-1 text-xl font-semibold text-white">Hourly verification</h2>
            <div className="mt-5 space-y-3">
              <RuleStep index="1" label="Read registered deposit wallets from the leaderboard wallet table." />
              <RuleStep index="2" label="Query Scallop, Bluefin, NAVI, and Suilend USDC, USDT, and USDSUI supply positions for each wallet." />
              <RuleStep index="3" label="If a protocol position is gone, that protocol contributes 0 for this snapshot." />
              <RuleStep index="4" label="Add verified USD values to the user's lifetime total points." />
            </div>
            {latestSnapshot?.warnings.length ? (
              <p className="mt-4 rounded-lg border border-[#FFEA4B]/30 bg-[#FFEA4B]/10 p-3 text-xs text-[#FFEA4B]">
                {latestSnapshot.warnings[0]}
              </p>
            ) : null}
          </aside>
        </section>
      </div>
    </main>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border border-[#373A4D] bg-[#151722]/95 p-4">
      <p className="text-sm text-[#8585B8]">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
      <p className="mt-2 text-sm text-[#a8a8c7]">{detail}</p>
    </div>
  );
}

function RuleStep({ index, label }: { index: string; label: string }) {
  return (
    <div className="flex gap-3 rounded-lg border border-[#373A4D] bg-[#0f111b] p-3">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-[#232534] text-xs font-semibold text-[#9FFFBF]">
        {index}
      </span>
      <p className="text-sm text-[#dfdfed]">{label}</p>
    </div>
  );
}

function StatusPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "green" | "violet";
}) {
  const toneClass = {
    green: "border-[#9FFFBF]/30 bg-[#9FFFBF]/10 text-[#9FFFBF]",
    violet: "border-[#7F7FFF]/30 bg-[#7F7FFF]/10 text-[#dfdfed]",
  }[tone];

  return (
    <div className={`flex h-10 items-center gap-2 rounded-lg border px-3 text-sm ${toneClass}`}>
      <span className="text-[#8585B8]">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function formatNumber(value: number) {
  return numberFormatter.format(value);
}

function formatSnapshotTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
