"use client";

import {
  ConnectModal,
  useCurrentAccount,
  useCurrentWallet,
  useDisconnectWallet,
  useSignAndExecuteTransaction,
} from "@mysten/dapp-kit";
import { useMutationState } from "@tanstack/react-query";
import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LENDING_ASSETS,
  STABLECOIN_ASSETS,
  isLendingAssetSupported,
} from "@/lib/lending/constants";
import { lendingAdapters } from "@/lib/lending/adapters";
import type { LendingAssetSymbol, LendingProtocolId } from "@/lib/lending/types";
import type {
  DataQuality,
  PositionsApiResponse,
  ProtocolId,
  UserLendingPosition,
  YieldApiResponse,
  YieldOpportunity,
} from "@/lib/yield-types";

const CLIENT_REFRESH_INTERVAL_MS = 30_000;
const DONATION_ADDRESS = process.env.NEXT_PUBLIC_DONATION_ADDRESS?.trim() ?? "";

const PROTOCOL_META: Record<
  ProtocolId,
  {
    accent: string;
    glow: string;
    label: string;
  }
> = {
  navi: {
    accent: "#7F7FFF",
    glow: "shadow-[0_0_36px_rgba(127,127,255,0.18)]",
    label: "Lending",
  },
  scallop: {
    accent: "#9FFFBF",
    glow: "shadow-[0_0_36px_rgba(159,255,191,0.16)]",
    label: "Lending",
  },
  bluefin: {
    accent: "#4BD8FF",
    glow: "shadow-[0_0_36px_rgba(75,216,255,0.15)]",
    label: "Lending",
  },
  suilend: {
    accent: "#FF8E5C",
    glow: "shadow-[0_0_36px_rgba(255,142,92,0.13)]",
    label: "Lending",
  },
};

const PROTOCOL_NAMES: Record<ProtocolId, string> = {
  navi: "NAVI Protocol",
  scallop: "Scallop",
  bluefin: "Bluefin Lend",
  suilend: "Suilend",
};

const PROTOCOL_ICONS: Record<ProtocolId, string> = {
  bluefin: "/protocolIcons/bluefin.avif",
  navi: "/protocolIcons/navi.png",
  scallop: "/protocolIcons/scallop.png",
  suilend: "/protocolIcons/suilend.svg",
};

const COIN_LOGOS: Record<LendingAssetSymbol, string> = {
  USDC: "/coinLogos/usdc.svg",
  USDSUI: "/coinLogos/usdSui.svg",
  USDT: "/coinLogos/usdt.svg",
};

const PROTOCOL_TOTAL = Object.keys(PROTOCOL_META).length;

const QUALITY_LABEL: Record<DataQuality, string> = {
  live: "Live",
  partial: "Partial",
  unavailable: "Offline",
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  notation: "compact",
  style: "currency",
});

const tokenAmountFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});

const percentFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});

export default function YieldDashboard() {
  const account = useCurrentAccount();
  const [data, setData] = useState<YieldApiResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [positionsData, setPositionsData] = useState<PositionsApiResponse | null>(null);
  const [isLoadingPositions, setIsLoadingPositions] = useState(false);
  const [positionsError, setPositionsError] = useState<string | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) {
      setIsLoading(true);
    }
    setError(null);

    try {
      const response = await fetch("/api/yields", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`API ${response.status}`);
      }

      const payload = (await response.json()) as YieldApiResponse;
      setData(payload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Failed to load yield data");
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => {
      void refresh();
    }, 0);
    const interval = window.setInterval(() => refresh(true), CLIENT_REFRESH_INTERVAL_MS);
    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(interval);
    };
  }, [refresh]);

  const refreshPositions = useCallback(async (address: string, silent = false) => {
    if (!silent) {
      setIsLoadingPositions(true);
    }
    setPositionsError(null);

    try {
      const response = await fetch(`/api/positions?address=${encodeURIComponent(address)}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`API ${response.status}`);
      }

      const payload = (await response.json()) as PositionsApiResponse;
      setPositionsData(payload);
    } catch (reason) {
      setPositionsError(reason instanceof Error ? reason.message : "Failed to load wallet positions");
    } finally {
      setIsLoadingPositions(false);
    }
  }, []);

  useEffect(() => {
    const address = account?.address ?? null;

    const initialRefresh = window.setTimeout(() => {
      if (!address) {
        setPositionsData(null);
        setPositionsError(null);
        setIsLoadingPositions(false);
        return;
      }
      void refreshPositions(address);
    }, 0);
    const interval = address
      ? window.setInterval(() => refreshPositions(address, true), CLIENT_REFRESH_INTERVAL_MS)
      : null;
    return () => {
      window.clearTimeout(initialRefresh);
      if (interval !== null) {
        window.clearInterval(interval);
      }
    };
  }, [account?.address, refreshPositions]);

  const best = useMemo(() => {
    return data?.opportunities.reduce<YieldOpportunity | null>((current, item) => {
      if (item.apy === null) return current;
      if (!current || item.apy > (current.apy ?? -1)) return item;
      return current;
    }, null) ?? null;
  }, [data]);

  const protocolHighlights = useMemo(() => {
    return data ? bestOpportunityByProtocol(data.opportunities) : null;
  }, [data]);

  const liveCount = useMemo(() => {
    if (!data) return 0;
    return new Set(data.opportunities.filter((item) => item.status === "live").map((item) => item.protocol)).size;
  }, [data]);

  return (
    <main className="min-h-screen bg-[#0b0d14] text-[#fdfdff]">
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(180deg,rgba(102,103,238,0.16)_0%,rgba(11,13,20,0)_26%),linear-gradient(90deg,rgba(159,255,191,0.07),rgba(242,77,176,0.06),rgba(255,234,75,0.04))]" />
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
              <p className="text-xs font-medium uppercase text-[#8585B8]">Sui mainnet yield router</p>
              <h1 className="text-2xl font-semibold text-white sm:text-3xl">Sui Lending Dashboard</h1>
            </div>
          </div>

          <div className="flex flex-col items-start gap-2 lg:items-end">
            <p className="max-w-full break-all text-xs text-[#8585B8]">
              ❤️ If you like this project, donations are welcome to help keep it running. Donation address:{" "}
              <span className="font-mono text-[#dfdfed]">
                {DONATION_ADDRESS || "Set NEXT_PUBLIC_DONATION_ADDRESS"}
              </span>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill label="Sui" value="Mainnet" tone="violet" />
              <StatusPill label="Assets" value="USDC / USDSUI / USDT" tone="green" />
              <Link
                className="flex h-10 items-center rounded-lg border border-[#373A4D] bg-[#232534] px-3 text-sm font-semibold text-white transition hover:border-[#9FFFBF]"
                href="/leaderboard"
              >
                Leaderboard
              </Link>
              <WalletConnectPill />
            </div>
          </div>
        </header>

        <section>
          <div className="min-h-[200px] w-full rounded-lg border border-[#373A4D] bg-[#151722]/95 p-5 shadow-[0_24px_90px_rgba(0,0,0,0.34)]">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm text-[#8585B8]">Current best stablecoin benchmark yield</p>
                <div className="mt-3 flex items-end gap-3">
                  <span className="text-5xl font-semibold text-white sm:text-6xl">
                    {best?.apy === null || !best ? "--" : formatPercent(best.apy)}
                  </span>
                  <span className="mb-2 text-sm font-semibold text-[#9FFFBF]">APY</span>
                </div>
              </div>
              <div className="rounded-lg border border-[#373A4D] bg-[#1c1e2c] px-3 py-2 text-right">
                <p className="text-xs text-[#8585B8]">Live protocols</p>
                <p className="mt-1 text-2xl font-semibold text-white">{liveCount}/{PROTOCOL_TOTAL}</p>
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <MetricBox label="Protocol" value={best?.protocolName ?? "--"} />
              <MetricBox label="Product" value={best?.asset ?? "--"} />
              <MetricBox label="TVL" value={formatCurrency(best?.tvlUsd)} />
            </div>

            <div className="mt-6 rounded-lg border border-[#373A4D] bg-[#0f111b] p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">{best?.product ?? "Waiting for live yield data"}</p>
                  <p className="mt-1 text-sm text-[#a8a8c7]">{best?.note ?? "Loading Sui stablecoin markets from yield sources."}</p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-xs text-[#8585B8]">APR</p>
                  <p className="text-lg font-semibold text-[#FFEA4B]">{formatPercent(best?.apr)}</p>
                </div>
              </div>
            </div>
          </div>

          {/* <div className="min-h-[312px] rounded-lg border border-[#373A4D] bg-[#151722]/95 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[#8585B8]">Data source status</p>
                <h2 className="mt-1 text-xl font-semibold text-white">Live aggregation path</h2>
              </div>
              <QualityBadge status={error ? "unavailable" : "live"} />
            </div>

            <div className="mt-5 space-y-3">
              <SourceRow
                label="Scallop SDK"
                status={data?.sources.scallopSdk ?? "partial"}
                value="Scallop USDC market"
              />
              <SourceRow
                label="NAVI open-api"
                status={data?.sources.naviOpenApi ?? "partial"}
                value="NAVI pool fields"
              />
              <SourceRow
                label="Bluefin Lend"
                status={data?.sources.bluefinLend ?? "partial"}
                value="Bluefin USDC lend market"
              />
              <SourceRow
                label="Suilend SDK"
                status={data?.sources.suilendSdk ?? "partial"}
                value="Stablecoin deposit adapter"
              />
              <SourceRow
                label="Client polling"
                status="live"
                value={data ? `${Math.round(data.refreshIntervalMs / 1000)}s` : "30s"}
              />
            </div>

            <div className="mt-5 border-t border-[#373A4D] pt-4">
              <p className="text-xs text-[#8585B8]">Last updated</p>
              <p className="mt-1 text-sm font-medium text-white">{formatDate(data?.generatedAt)}</p>
              {error ? <p className="mt-3 text-sm text-[#FF4D29]">Load failed: {error}</p> : null}
              {!error && data?.warnings.length ? (
                <p className="mt-3 text-sm text-[#FFEA4B]">{data.warnings[0]}</p>
              ) : null}
            </div>
          </div> */}
        </section>

        <PositionsPanel
          address={account?.address ?? null}
          data={positionsData}
          error={positionsError}
          loading={isLoadingPositions}
          onRefresh={() => {
            if (account?.address) void refreshPositions(account.address, true);
          }}
        />

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {(protocolHighlights ?? skeletonProtocols()).map((opportunity) => (
            <ProtocolCard
              key={opportunity.id}
              opportunity={opportunity}
              protocolOpportunities={data?.opportunities.filter((item) => item.protocol === opportunity.protocol) ?? []}
              loading={isLoading && !data}
              onDepositComplete={() => {
                if (account?.address) void refreshPositions(account.address, true);
              }}
            />
          ))}
        </section>

        <section className="rounded-lg border border-[#373A4D] bg-[#151722]/95">
          <div className="flex flex-col gap-2 border-b border-[#373A4D] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-[#8585B8]">APR / APY details</p>
              <h2 className="text-xl font-semibold text-white">Stablecoin yield list</h2>
            </div>
            <p className="text-sm text-[#a8a8c7]">Scallop / Bluefin / NAVI use protocol SDKs or first-party APIs.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] table-fixed text-left">
              <thead className="text-xs uppercase text-[#8585B8]">
                <tr className="border-b border-[#373A4D]">
                  <th className="w-[180px] px-4 py-3 font-medium">Protocol</th>
                  <th className="w-[220px] px-4 py-3 font-medium">Product</th>
                  <th className="w-[120px] px-4 py-3 text-right font-medium">APR</th>
                  <th className="w-[120px] px-4 py-3 text-right font-medium">APY</th>
                  <th className="w-[180px] px-4 py-3 font-medium">Boost details</th>
                  <th className="w-[140px] px-4 py-3 text-right font-medium">TVL</th>
                  <th className="w-[130px] px-4 py-3 font-medium">Risk</th>
                  <th className="w-[150px] px-4 py-3 font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {(data?.opportunities ?? skeletonProtocols()).map((item) => (
                  <tr key={`${item.id}-row`} className="border-b border-[#232534] last:border-b-0">
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <ProtocolAssetIcons asset={item.asset} protocol={item.protocol} protocolName={item.protocolName} />
                        <span className="font-semibold text-white">{item.protocolName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-sm text-[#dfdfed]">{item.product}</td>
                    <td className="px-4 py-4 text-right font-semibold text-[#FFEA4B]">
                      {formatPercent(item.apr)}
                    </td>
                    <td className="px-4 py-4 text-right font-semibold text-[#9FFFBF]">
                      {formatPercent(item.apy)}
                    </td>
                    <td className="px-4 py-4 text-sm text-[#dfdfed]">{breakdownLabel(item)}</td>
                    <td className="px-4 py-4 text-right text-sm text-[#dfdfed]">{formatCurrency(item.tvlUsd)}</td>
                    <td className="px-4 py-4 text-sm text-[#dfdfed]">{riskLabel(item)}</td>
                    <td className="px-4 py-4 text-sm text-[#a8a8c7]">{item.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

function PositionsPanel({
  address,
  data,
  error,
  loading,
  onRefresh,
}: {
  address: string | null;
  data: PositionsApiResponse | null;
  error: string | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const positions = data?.positions ?? [];
  const signAndExecute = useSignAndExecuteTransaction();
  const [claimAllStatus, setClaimAllStatus] = useState<string | null>(null);
  const [isClaimingAll, setIsClaimingAll] = useState(false);

  const claimAllRewards = async () => {
    if (!address) {
      setClaimAllStatus("Connect your Sui wallet first.");
      return;
    }

    try {
      setIsClaimingAll(true);
      setClaimAllStatus("Finding claimable rewards...");
      const { buildClaimAllRewardTransactions } = await import("@/lib/lending/claim-all");
      const steps = await buildClaimAllRewardTransactions({
        address,
        positions,
      });

      for (const [index, step] of steps.entries()) {
        setClaimAllStatus(`Waiting for wallet signature ${index + 1}/${steps.length}: ${step.summary}`);
        const result = await signAndExecute.mutateAsync({ transaction: step.tx });
        const digest = "digest" in result ? result.digest : undefined;
        setClaimAllStatus(
          digest
            ? `Submitted ${index + 1}/${steps.length}: ${step.protocolName} ${digest}`
            : `Submitted ${index + 1}/${steps.length}: ${step.protocolName}`,
        );
      }

      setClaimAllStatus(`Claimed rewards from ${steps.length} transaction${steps.length === 1 ? "" : "s"}.`);
      onRefresh();
    } catch (reason) {
      setClaimAllStatus(reason instanceof Error ? reason.message : "Claim all rewards failed");
    } finally {
      setIsClaimingAll(false);
    }
  };

  return (
    <section className="rounded-lg border border-[#373A4D] bg-[#151722]/95">
      <div className="flex flex-col gap-3 border-b border-[#373A4D] p-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm text-[#8585B8]">Wallet positions</p>
          <h2 className="text-xl font-semibold text-white">Protocol positions</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data ? (
            (Object.keys(PROTOCOL_META) as ProtocolId[]).map((protocol) => (
              <StatusPill
                key={`position-source-${protocol}`}
                label={PROTOCOL_NAMES[protocol]}
                value={QUALITY_LABEL[data.sources[protocol]]}
                tone={data.sources[protocol] === "live" ? "green" : "yellow"}
              />
            ))
          ) : null}
          <button
            className="h-10 rounded-lg border border-[#FFEA4B]/40 bg-[#FFEA4B]/10 px-4 text-sm font-semibold text-[#FFEA4B] transition hover:bg-[#FFEA4B]/15 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!address || loading || isClaimingAll}
            onClick={claimAllRewards}
            type="button"
          >
            {isClaimingAll ? "Claiming" : "Claim all rewards"}
          </button>
          <button
            className="h-10 rounded-lg border border-[#373A4D] bg-[#232534] px-4 text-sm font-semibold text-white transition hover:border-[#9FFFBF] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!address || loading}
            onClick={onRefresh}
            type="button"
          >
            {loading ? "Querying" : "Refresh positions"}
          </button>
        </div>
      </div>

      {claimAllStatus ? (
        <div className="border-b border-[#373A4D] px-4 py-3 text-sm text-[#dfdfed]">{claimAllStatus}</div>
      ) : null}

      {!address ? (
        <div className="p-4 text-sm text-[#a8a8c7]">Connect a wallet to view stablecoin positions on Scallop, Bluefin Lend, NAVI, and Suilend.</div>
      ) : error ? (
        <div className="p-4 text-sm text-[#FF4D29]">Position load failed: {error}</div>
      ) : loading && !data ? (
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
          {skeletonPositions().map((position) => (
            <PositionCard key={position.id} position={position} loading />
          ))}
        </div>
      ) : positions.length ? (
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
          {positions.map((position) => (
            <PositionCard key={position.id} position={position} loading={false} onRefresh={onRefresh} />
          ))}
        </div>
      ) : (
        <div className="p-4">
          <p className="text-sm text-[#a8a8c7]">No displayable Scallop / Bluefin Lend / NAVI / Suilend stablecoin positions were found for this wallet.</p>
          {data?.warnings[0] ? <p className="mt-2 text-sm text-[#FFEA4B]">{data.warnings[0]}</p> : null}
        </div>
      )}

      {data?.warnings.length ? (
        <div className="border-t border-[#373A4D] px-4 py-3 text-sm text-[#FFEA4B]">{data.warnings[0]}</div>
      ) : null}
    </section>
  );
}

const WITHDRAW_PERCENT_PRESETS = [25, 50, 75, 100] as const;

function PositionCard({
  position,
  loading,
  onRefresh,
}: {
  position: UserLendingPosition;
  loading: boolean;
  onRefresh?: () => void;
}) {
  const meta = PROTOCOL_META[position.protocol];
  const account = useCurrentAccount();
  const signAndExecute = useSignAndExecuteTransaction();
  const [showWithdrawPanel, setShowWithdrawPanel] = useState(false);
  const [withdrawPercent, setWithdrawPercent] = useState(100);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [isBuilding, setIsBuilding] = useState(false);

  const actionMeta = position.action;
  const isBusy = isBuilding || signAndExecute.isPending;
  const canOperate = Boolean(actionMeta) && Boolean(account?.address) && !loading && !isBusy;

  const runAction = async (action: "withdraw" | "claimRewards") => {
    if (!account?.address) {
      setActionStatus("Connect your Sui wallet first.");
      return;
    }

    try {
      setIsBuilding(true);
      setActionStatus("Building transaction...");
      const { buildPositionActionTransaction } = await import("@/lib/lending/position-actions");
      const { tx, summary } = await buildPositionActionTransaction({
        address: account.address,
        position,
        action,
        percent: action === "withdraw" ? withdrawPercent : undefined,
      });

      setActionStatus("Waiting for wallet signature...");
      const result = await signAndExecute.mutateAsync({ transaction: tx });
      const digest = "digest" in result ? result.digest : undefined;
      setActionStatus(digest ? `${summary} submitted: ${digest}` : `${summary} submitted.`);
      setShowWithdrawPanel(false);
      onRefresh?.();
    } catch (reason) {
      setActionStatus(reason instanceof Error ? reason.message : "Transaction build or execution failed");
    } finally {
      setIsBuilding(false);
    }
  };

  return (
    <article className="rounded-lg border border-[#373A4D] bg-[#0f111b] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">{loading ? "--" : position.protocolName}</p>
          <p className="mt-1 text-xs text-[#8585B8]">{loading ? "Loading" : position.source}</p>
        </div>
        <span
          className="rounded-md border px-2 py-1 text-xs font-semibold"
          style={{ borderColor: `${meta.accent}66`, color: meta.accent }}
        >
          {loading ? "--" : sideLabel(position.side)}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-[#8585B8]">Asset</p>
          <p className="mt-1 truncate text-sm font-semibold text-white">{loading ? "--" : position.asset}</p>
        </div>
        <div>
          <p className="text-xs text-[#8585B8]">APR</p>
          <p className="mt-1 text-sm font-semibold text-[#FFEA4B]">{loading ? "--" : formatPercent(position.apr)}</p>
        </div>
      </div>

      <div className="mt-4">
        <p className="text-xs text-[#8585B8]">Amount</p>
        <p className="mt-1 truncate text-lg font-semibold text-white">{loading ? "--" : position.amount}</p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs text-[#8585B8]">Value</p>
          <p className="mt-1 font-semibold text-[#9FFFBF]">{loading ? "--" : formatCurrency(position.valueUsd)}</p>
        </div>
        <div>
          <p className="text-xs text-[#8585B8]">Rewards</p>
          <p className="mt-1 truncate font-semibold text-white">{loading ? "--" : rewardLabel(position)}</p>
        </div>
      </div>

      <p className="mt-4 line-clamp-2 min-h-10 text-sm text-[#a8a8c7]">{loading ? "Loading" : position.note}</p>

      {!loading && actionMeta ? (
        <div className="mt-4 border-t border-[#373A4D] pt-3">
          <div className="flex flex-wrap gap-2">
            {actionMeta.withdrawable ? (
              <button
                className="h-9 rounded-lg border border-[#9FFFBF]/40 bg-[#9FFFBF]/10 px-3 text-sm font-semibold text-[#9FFFBF] transition hover:bg-[#9FFFBF]/15 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canOperate}
                onClick={() => setShowWithdrawPanel((current) => !current)}
                type="button"
              >
                Withdraw
              </button>
            ) : null}
            <button
              className="h-9 rounded-lg border border-[#FFEA4B]/40 bg-[#FFEA4B]/10 px-3 text-sm font-semibold text-[#FFEA4B] transition hover:bg-[#FFEA4B]/15 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canOperate || !actionMeta.claimable}
              onClick={() => runAction("claimRewards")}
              type="button"
            >
              {actionMeta.claimable ? "Claim rewards" : "No rewards"}
            </button>
          </div>

          {showWithdrawPanel && actionMeta.withdrawable ? (
            <div className="mt-3 rounded-lg border border-[#373A4D] bg-[#151722] p-3">
              <p className="text-xs text-[#8585B8]">Withdrawal percent</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {WITHDRAW_PERCENT_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    className={`h-8 rounded-md border px-2.5 text-xs font-semibold transition ${withdrawPercent === preset
                      ? "border-[#9FFFBF] bg-[#9FFFBF]/15 text-[#9FFFBF]"
                      : "border-[#373A4D] bg-[#232534] text-white hover:border-[#9FFFBF]/60"
                      }`}
                    onClick={() => setWithdrawPercent(preset)}
                    type="button"
                  >
                    {preset}%
                  </button>
                ))}
                <input
                  className="h-8 w-20 rounded-md border border-[#373A4D] bg-[#232534] px-2 text-sm text-white outline-none focus:border-[#9FFFBF]/60"
                  inputMode="numeric"
                  max={100}
                  min={1}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (Number.isFinite(value)) {
                      setWithdrawPercent(Math.min(100, Math.max(1, Math.floor(value))));
                    }
                  }}
                  type="number"
                  value={withdrawPercent}
                />
                <span className="text-xs text-[#8585B8]">%</span>
              </div>
              <button
                className="mt-3 h-9 w-full rounded-lg border border-[#9FFFBF]/40 bg-[#9FFFBF]/10 px-3 text-sm font-semibold text-[#9FFFBF] transition hover:bg-[#9FFFBF]/15 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canOperate}
                onClick={() => runAction("withdraw")}
                type="button"
              >
                {isBusy ? "Executing" : `Confirm withdraw ${withdrawPercent}%`}
              </button>
            </div>
          ) : null}

          {actionStatus ? (
            <p className="mt-3 break-all rounded-lg border border-[#373A4D] bg-[#151722] p-2.5 text-xs text-[#dfdfed]">
              {actionStatus}
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function ProtocolCard({
  opportunity,
  protocolOpportunities,
  loading,
  onDepositComplete,
}: {
  opportunity: YieldOpportunity;
  protocolOpportunities: YieldOpportunity[];
  loading: boolean;
  onDepositComplete?: () => void;
}) {
  const meta = PROTOCOL_META[opportunity.protocol];
  const account = useCurrentAccount();
  const signAndExecute = useSignAndExecuteTransaction();
  const protocol: LendingProtocolId = opportunity.protocol;
  const [selectedAsset, setSelectedAsset] = useState<LendingAssetSymbol>(
    toLendingAssetSymbol(opportunity.asset) ?? "USDC",
  );
  const [amount, setAmount] = useState("");
  const [depositStatus, setDepositStatus] = useState<string | null>(null);
  const [isBuildingDeposit, setIsBuildingDeposit] = useState(false);
  const displayOpportunity =
    protocolOpportunities.find((item) => item.asset.toUpperCase() === selectedAsset) ?? opportunity;
  const barWidth = Math.min(Math.max(displayOpportunity.apy ?? 0, 0), 60);
  const selectedAssetMeta = LENDING_ASSETS[selectedAsset];
  const assetSupported = isLendingAssetSupported(protocol, selectedAsset);
  const isBusy = isBuildingDeposit || signAndExecute.isPending;
  const canDeposit = Boolean(account?.address) && !loading && assetSupported && amount.trim().length > 0 && !isBusy;


  const executeDeposit = async () => {
    if (!account?.address) {
      setDepositStatus("Connect your Sui wallet first.");
      return;
    }

    const adapter = lendingAdapters[protocol];
    if (!adapter) {
      setDepositStatus("No adapter is available for this protocol.");
      return;
    }
    if (!assetSupported) {
      setDepositStatus(opportunity.protocolName + " does not support " + selectedAsset + " through this adapter yet.");
      return;
    }

    try {
      setIsBuildingDeposit(true);
      setDepositStatus("Building deposit transaction...");
      const { tx, summary } = await adapter.buildTransaction({
        input: {
          action: "deposit",
          address: account.address,
          amount,
          asset: selectedAsset,
          bluefinPositionCapId: "",
          protocol,
          scallopObligationId: "",
          scallopObligationKeyId: "",
        },
      });

      setDepositStatus("Waiting for wallet signature...");
      const result = await signAndExecute.mutateAsync({ transaction: tx });
      const digest = "digest" in result ? result.digest : undefined;
      setDepositStatus(digest ? summary + " submitted: " + digest : summary + " submitted.");
      registerLeaderboardWallet({
        address: account.address,
        amount,
        asset: selectedAsset,
        digest,
        protocol,
      }).catch((leaderboardError) => {
        setDepositStatus((current) =>
          `${current ?? "Deposit submitted."} Leaderboard registration warning: ${leaderboardError instanceof Error ? leaderboardError.message : "unknown error"
          }`,
        );
      });
      setAmount("");
      onDepositComplete?.();
    } catch (reason) {
      setDepositStatus(reason instanceof Error ? reason.message : "Deposit transaction failed");
    } finally {
      setIsBuildingDeposit(false);
    }
  };

  return (
    <article className={"min-h-[356px] rounded-lg border border-[#373A4D] bg-[#151722]/95 p-4 " + meta.glow}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center overflow-hidden rounded-lg border border-[#373A4D] bg-[#1c1e2c] p-1.5">
            <Image
              alt={`${opportunity.protocolName} icon`}
              className="size-full object-contain"
              height={40}
              src={PROTOCOL_ICONS[opportunity.protocol]}
              unoptimized={PROTOCOL_ICONS[opportunity.protocol].endsWith(".svg")}
              width={40}
            />
          </div>
          <div>
            <h3 className="font-semibold text-white">{opportunity.protocolName}</h3>
            <p className="text-xs text-[#8585B8]">{meta.label}</p>
          </div>
        </div>
        <QualityBadge status={loading ? "partial" : displayOpportunity.status} />
      </div>

      <div className="mt-5">
        <p className="text-xs text-[#8585B8]">APY</p>
        <p className="mt-1 text-4xl font-semibold text-white">{loading ? "--" : formatPercent(displayOpportunity.apy)}</p>
      </div>

      <div className="mt-4 h-2 rounded-md bg-[#232534]">
        <div
          className="h-2 rounded-md"
          style={{
            backgroundColor: meta.accent,
            width: (loading ? 0 : barWidth) + "%",
          }}
        />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs text-[#8585B8]">APR</p>
          <p className="font-semibold text-[#FFEA4B]">{loading ? "--" : formatPercent(displayOpportunity.apr)}</p>
        </div>
        <div>
          <p className="text-xs text-[#8585B8]">TVL</p>
          <p className="font-semibold text-white">{loading ? "--" : formatCurrency(displayOpportunity.tvlUsd)}</p>
        </div>
      </div>

      <div className="mt-4 rounded-md border border-[#373A4D] bg-[#0f111b] p-3 text-[10px] text-[#a8a8c7]">
        {loading ? "--" : breakdownLabel(displayOpportunity)}
      </div>

      <p className="mt-4 min-h-10 text-sm text-[#a8a8c7]">{displayOpportunity.product}</p>

      <div className="mt-4 border-t border-[#373A4D] pt-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-white">Quick deposit</p>
          <span className="rounded-md border border-[#373A4D] bg-[#0f111b] px-2 py-1 text-xs font-semibold text-[#dfdfed]">
            {selectedAssetMeta.symbol}
          </span>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-[0.9fr_1.1fr]">
          <select
            className="control h-10"
            value={selectedAsset}
            onChange={(event) => setSelectedAsset(event.target.value as LendingAssetSymbol)}
            disabled={loading || isBusy}
          >
            {STABLECOIN_ASSETS.map((asset) => (
              <option key={asset.symbol} value={asset.symbol} disabled={!isLendingAssetSupported(protocol, asset.symbol)}>
                {asset.symbol}
              </option>
            ))}
          </select>
          <input
            className="control h-10"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            disabled={loading || isBusy}
          />
        </div>
        {!assetSupported ? (
          <p className="mt-2 text-xs text-[#FFEA4B]">
            {opportunity.protocolName} does not support {selectedAsset} through this adapter yet.
          </p>
        ) : null}
        <button
          className="mt-3 h-10 w-full rounded-lg border border-[#9FFFBF]/40 bg-[#9FFFBF]/10 px-3 text-sm font-semibold text-[#9FFFBF] transition hover:bg-[#9FFFBF]/15 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canDeposit}
          onClick={executeDeposit}
          type="button"
        >
          {!account?.address ? "Connect wallet" : isBusy ? "Executing" : "Deposit"}
        </button>
        {depositStatus ? (
          <p className="mt-3 break-all rounded-lg border border-[#373A4D] bg-[#0f111b] p-2.5 text-xs text-[#dfdfed]">
            {depositStatus}
          </p>
        ) : null}
      </div>
    </article>
  );
}

async function registerLeaderboardWallet(input: {
  address: string;
  protocol: LendingProtocolId;
  asset: LendingAssetSymbol;
  amount: string;
  digest?: string;
}) {
  const response = await fetch("/api/leaderboard/register", {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Leaderboard registration failed: API ${response.status}`);
  }
}

function StatusPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "green" | "violet" | "yellow";
}) {
  const toneClass = {
    green: "border-[#9FFFBF]/30 bg-[#9FFFBF]/10 text-[#9FFFBF]",
    violet: "border-[#7F7FFF]/30 bg-[#7F7FFF]/10 text-[#dfdfed]",
    yellow: "border-[#FFEA4B]/30 bg-[#FFEA4B]/10 text-[#FFEA4B]",
  }[tone];

  return (
    <div className={`flex h-10 items-center gap-2 rounded-lg border px-3 text-sm ${toneClass}`}>
      <span className="text-[#8585B8]">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function WalletConnectPill() {
  const account = useCurrentAccount();
  const { isConnecting, isConnected } = useCurrentWallet();
  const disconnectWallet = useDisconnectWallet();
  const [open, setOpen] = useState(false);
  const [hadDisconnectError, setHadDisconnectError] = useState(false);
  const connectMutationErrors = useMutationState({
    filters: {
      mutationKey: [{ baseEntity: "connect-wallet", baseScope: "wallet" }],
    },
    select: (mutation) => mutation.state.status === "error",
  });

  const showConnectionError = !isConnected && (hadDisconnectError || connectMutationErrors.some(Boolean));
  const tone = isConnected ? "green" : showConnectionError ? "red" : "violet";
  const toneClass = {
    green: "border-[#9FFFBF]/30 bg-[#9FFFBF]/10 text-[#9FFFBF] shadow-[0_0_22px_rgba(159,255,191,0.10)] hover:border-[#9FFFBF]/55",
    red: "border-[#FF4D29]/35 bg-[#FF4D29]/10 text-[#FF4D29] shadow-[0_0_22px_rgba(255,77,41,0.10)] hover:border-[#FF4D29]/60",
    violet: "border-[#7F7FFF]/35 bg-[#7F7FFF]/10 text-[#dfdfed] shadow-[0_0_22px_rgba(127,127,255,0.12)] hover:border-[#7F7FFF]/60",
  }[tone];

  const value = isConnected && account?.address
    ? formatAddress(account.address)
    : isConnecting
      ? "Connecting"
      : showConnectionError
        ? "Error"
        : "Connect";

  const button = (
    <button
      className={`flex h-10 items-center cursor-pointer gap-2 rounded-lg border px-3 text-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${toneClass}`}
      disabled={disconnectWallet.isPending}
      onClick={
        isConnected
          ? () => {
            disconnectWallet.mutate(undefined, {
              onError: () => setHadDisconnectError(true),
              onSuccess: () => setHadDisconnectError(false),
            });
          }
          : undefined
      }
      type="button"
    >
      <span className="text-[#8585B8]">Wallet</span>
      <span className="font-semibold">{value}</span>
    </button>
  );

  if (isConnected) {
    return button;
  }

  return (
    <ConnectModal
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          setHadDisconnectError(false);
        }
      }}
      trigger={button}
    />
  );
}

function ProtocolAssetIcons({
  asset,
  protocol,
  protocolName,
}: {
  asset: string;
  protocol: ProtocolId;
  protocolName: string;
}) {
  const coinLogo = coinLogoForAsset(asset);

  return (
    <div className="relative h-8 w-14 shrink-0">
      <span className="absolute left-0 top-0 grid size-8 place-items-center overflow-hidden rounded-md border border-[#373A4D] bg-[#1c1e2c] p-1">
        <Image
          alt={`${protocolName} icon`}
          className="size-full object-contain"
          height={32}
          src={PROTOCOL_ICONS[protocol]}
          unoptimized={PROTOCOL_ICONS[protocol].endsWith(".svg")}
          width={32}
        />
      </span>
      {coinLogo ? (
        <span className="absolute left-6 top-0 grid size-8 place-items-center overflow-hidden rounded-full border border-[#373A4D] bg-[#0f111b] p-1 shadow-[0_0_14px_rgba(0,0,0,0.28)]">
          <Image
            alt={`${asset} icon`}
            className="size-full object-contain"
            height={32}
            src={coinLogo}
            unoptimized
            width={32}
          />
        </span>
      ) : null}
    </div>
  );
}

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#373A4D] bg-[#1c1e2c] p-3">
      <p className="text-xs text-[#8585B8]">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function QualityBadge({ status }: { status: DataQuality }) {
  const className =
    status === "live"
      ? "border-[#9FFFBF]/35 bg-[#9FFFBF]/10 text-[#9FFFBF]"
      : status === "partial"
        ? "border-[#FFEA4B]/35 bg-[#FFEA4B]/10 text-[#FFEA4B]"
        : "border-[#FF4D29]/35 bg-[#FF4D29]/10 text-[#FF4D29]";

  return (
    <span className={`inline-flex h-7 items-center rounded-md border px-2 text-xs font-semibold ${className}`}>
      {QUALITY_LABEL[status]}
    </span>
  );
}

function SourceRow({
  label,
  status,
  value,
}: {
  label: string;
  status: DataQuality;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-[#373A4D] bg-[#1c1e2c] px-3 py-3">
      <div>
        <p className="text-sm font-semibold text-white">{label}</p>
        <p className="text-xs text-[#8585B8]">{value}</p>
      </div>
      <QualityBadge status={status} />
    </div>
  );
}

function skeletonProtocols(): YieldOpportunity[] {
  return (Object.keys(PROTOCOL_META) as ProtocolId[]).map((protocol) => ({
    id: `${protocol}-loading`,
    protocol,
    protocolName: PROTOCOL_NAMES[protocol],
    product: "Loading stablecoin market",
    asset: "Stablecoins",
    apr: null,
    apy: null,
    tvlUsd: null,
    baseApy: null,
    rewardApy: null,
    borrowApr: null,
    utilization: null,
    exposure: "unknown",
    ilRisk: "unknown",
    source: "Loading",
    poolId: null,
    url: null,
    status: "partial",
    note: "Loading",
    rateBreakdown: [],
  }));
}

function bestOpportunityByProtocol(opportunities: YieldOpportunity[]) {
  const byProtocol = new Map<ProtocolId, YieldOpportunity>();

  for (const opportunity of opportunities) {
    const current = byProtocol.get(opportunity.protocol);
    if (!current || (opportunity.apy ?? -1) > (current.apy ?? -1)) {
      byProtocol.set(opportunity.protocol, opportunity);
    }
  }

  return (Object.keys(PROTOCOL_META) as ProtocolId[]).map((protocol) => {
    return byProtocol.get(protocol) ?? skeletonProtocols().find((item) => item.protocol === protocol)!;
  });
}

function skeletonPositions(): UserLendingPosition[] {
  return (Object.keys(PROTOCOL_META) as ProtocolId[]).map((protocol) => ({
    id: `${protocol}-position-loading`,
    protocol,
    protocolName: PROTOCOL_NAMES[protocol],
    product: "Loading",
    asset: "--",
    side: "supply",
    amount: "--",
    valueUsd: null,
    apr: null,
    rewards: [],
    positionId: null,
    url: null,
    source: "Loading",
    status: "partial",
    note: "Loading wallet position",
  }));
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return "--";
  return `${percentFormatter.format(value)}%`;
}

function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined) return "--";
  return currencyFormatter.format(value);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "--";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

function formatAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function coinLogoForAsset(asset: string) {
  const symbol = asset.toUpperCase() as LendingAssetSymbol;
  return COIN_LOGOS[symbol] ?? null;
}

function toLendingAssetSymbol(asset: string) {
  const symbol = asset.toUpperCase() as LendingAssetSymbol;
  return LENDING_ASSETS[symbol] ? symbol : null;
}

function sideLabel(side: UserLendingPosition["side"]) {
  return side === "supply" ? "Supply" : "Borrow";
}

function rewardLabel(position: UserLendingPosition) {
  if (!position.rewards.length) return "--";
  return position.rewards.map((reward) => `${formatTokenAmountText(reward.amount)} ${reward.label}`).join(" / ");
}

function formatTokenAmountText(value: string) {
  const numeric = Number(value.replace(/,/g, "").trim());
  if (!Number.isFinite(numeric)) return value;
  return tokenAmountFormatter.format(numeric);
}

function breakdownLabel(item: YieldOpportunity) {
  const entries = item.rateBreakdown
    .filter((entry) => entry.value !== null)
    .filter((entry) => entry.kind !== "borrow")
    .slice(0, 3);
  if (!entries.length) return "--";
  return entries.map((entry) => `${entry.label} ${formatPercent(entry.value)}`).join(" / ");
}

function riskLabel(item: YieldOpportunity) {
  if (item.ilRisk === "no" && item.exposure === "single") return "Single asset";
  if (item.ilRisk === "yes") return "LP / IL";
  if (item.exposure === "multi") return "Multi-asset";
  return item.ilRisk === "unknown" ? "Unknown" : item.ilRisk;
}
