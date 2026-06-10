"use client";

import { ConnectButton, useCurrentAccount, useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LENDING_ACTION_LABELS, LENDING_ASSETS, PROTOCOL_CAPABILITIES } from "@/lib/lending/constants";
import { lendingAdapters } from "@/lib/lending/adapters";
import type { LendingAction, LendingAssetSymbol, LendingFormInput, LendingProtocolId, RewardRow } from "@/lib/lending/types";
import type {
  DataQuality,
  PositionsApiResponse,
  ProtocolId,
  UserLendingPosition,
  YieldApiResponse,
  YieldOpportunity,
} from "@/lib/yield-types";

const CLIENT_REFRESH_INTERVAL_MS = 30_000;

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
};

const PROTOCOL_NAMES: Record<ProtocolId, string> = {
  navi: "NAVI Protocol",
  scallop: "Scallop",
  bluefin: "Bluefin Lend",
};

const PROTOCOL_TOTAL = Object.keys(PROTOCOL_META).length;

const DEFAULT_LENDING_FORM: Omit<LendingFormInput, "address"> = {
  action: "deposit",
  bluefinPositionCapId: "",
  amount: "",
  asset: "USDC",
  protocol: "scallop",
  scallopObligationId: "",
  scallopObligationKeyId: "",
};

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
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [positionsData, setPositionsData] = useState<PositionsApiResponse | null>(null);
  const [isLoadingPositions, setIsLoadingPositions] = useState(false);
  const [positionsError, setPositionsError] = useState<string | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (silent) {
      setIsRefreshing(true);
    } else {
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
      setIsLoading(false);
      setIsRefreshing(false);
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
    return data?.opportunities.find((item) => item.apy !== null) ?? null;
  }, [data]);

  const liveCount = data?.opportunities.filter((item) => item.status === "live").length ?? 0;

  return (
    <main className="min-h-screen bg-[#0b0d14] text-[#fdfdff]">
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(180deg,rgba(102,103,238,0.16)_0%,rgba(11,13,20,0)_26%),linear-gradient(90deg,rgba(159,255,191,0.07),rgba(242,77,176,0.06),rgba(255,234,75,0.04))]" />
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:48px_48px] opacity-30" />

      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-[#373A4D]/70 pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-lg border border-[#373A4D] bg-[#1c1e2c] text-sm font-black text-[#9FFFBF]">
              SY
            </div>
            <div>
              <p className="text-xs font-medium uppercase text-[#8585B8]">Sui mainnet yield router</p>
              <h1 className="text-2xl font-semibold text-white sm:text-3xl">USDC 实时收益面板</h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <StatusPill label="Sui" value="Mainnet" tone="violet" />
            <StatusPill label="资产" value="USDC" tone="green" />
            <StatusPill label="刷新" value="30s" tone="yellow" />
            <button
              className="h-10 rounded-lg border border-[#373A4D] bg-[#232534] px-4 text-sm font-semibold text-white transition hover:border-[#9FFFBF] hover:text-[#9FFFBF] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isLoading || isRefreshing}
              onClick={() => refresh(true)}
              type="button"
            >
              {isRefreshing ? "刷新中" : "刷新数据"}
            </button>
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="min-h-[312px] rounded-lg border border-[#373A4D] bg-[#151722]/95 p-5 shadow-[0_24px_90px_rgba(0,0,0,0.34)]">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm text-[#8585B8]">当前最高 USDC 收益</p>
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
              <MetricBox label="协议" value={best?.protocolName ?? "--"} />
              <MetricBox label="产品" value={best?.asset ?? "--"} />
              <MetricBox label="TVL" value={formatCurrency(best?.tvlUsd)} />
            </div>

            <div className="mt-6 rounded-lg border border-[#373A4D] bg-[#0f111b] p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">{best?.product ?? "等待实时收益数据"}</p>
                  <p className="mt-1 text-sm text-[#a8a8c7]">{best?.note ?? "正在从收益源加载 Sui USDC 市场。"}</p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-xs text-[#8585B8]">APR</p>
                  <p className="text-lg font-semibold text-[#FFEA4B]">{formatPercent(best?.apr)}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="min-h-[312px] rounded-lg border border-[#373A4D] bg-[#151722]/95 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[#8585B8]">数据源状态</p>
                <h2 className="mt-1 text-xl font-semibold text-white">实时聚合路径</h2>
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
                label="前端轮询"
                status="live"
                value={data ? `${Math.round(data.refreshIntervalMs / 1000)} 秒` : "30 秒"}
              />
            </div>

            <div className="mt-5 border-t border-[#373A4D] pt-4">
              <p className="text-xs text-[#8585B8]">最后更新</p>
              <p className="mt-1 text-sm font-medium text-white">{formatDate(data?.generatedAt)}</p>
              {error ? <p className="mt-3 text-sm text-[#FF4D29]">加载失败：{error}</p> : null}
              {!error && data?.warnings.length ? (
                <p className="mt-3 text-sm text-[#FFEA4B]">{data.warnings[0]}</p>
              ) : null}
            </div>
          </div>
        </section>

        <LendingWorkbench />

        <PositionsPanel
          address={account?.address ?? null}
          data={positionsData}
          error={positionsError}
          loading={isLoadingPositions}
          onRefresh={() => {
            if (account?.address) void refreshPositions(account.address, true);
          }}
        />

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(data?.opportunities ?? skeletonProtocols()).map((opportunity) => (
            <ProtocolCard key={opportunity.id} opportunity={opportunity} loading={isLoading && !data} />
          ))}
        </section>

        <section className="rounded-lg border border-[#373A4D] bg-[#151722]/95">
          <div className="flex flex-col gap-2 border-b border-[#373A4D] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-[#8585B8]">APR / APY 明细</p>
              <h2 className="text-xl font-semibold text-white">USDC 收益列表</h2>
            </div>
            <p className="text-sm text-[#a8a8c7]">Scallop / Bluefin / NAVI 使用协议 SDK 或同源 API。</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] table-fixed text-left">
              <thead className="text-xs uppercase text-[#8585B8]">
                <tr className="border-b border-[#373A4D]">
                  <th className="w-[180px] px-4 py-3 font-medium">协议</th>
                  <th className="w-[220px] px-4 py-3 font-medium">产品</th>
                  <th className="w-[120px] px-4 py-3 text-right font-medium">APR</th>
                  <th className="w-[120px] px-4 py-3 text-right font-medium">APY</th>
                  <th className="w-[180px] px-4 py-3 font-medium">加成明细</th>
                  <th className="w-[140px] px-4 py-3 text-right font-medium">TVL</th>
                  <th className="w-[130px] px-4 py-3 font-medium">风险</th>
                  <th className="w-[150px] px-4 py-3 font-medium">来源</th>
                </tr>
              </thead>
              <tbody>
                {(data?.opportunities ?? skeletonProtocols()).map((item) => (
                  <tr key={`${item.id}-row`} className="border-b border-[#232534] last:border-b-0">
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <span
                          className="size-3 rounded-sm"
                          style={{ backgroundColor: PROTOCOL_META[item.protocol].accent }}
                        />
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

function LendingWorkbench() {
  const account = useCurrentAccount();
  const signAndExecute = useSignAndExecuteTransaction();
  const [form, setForm] = useState(DEFAULT_LENDING_FORM);
  const [status, setStatus] = useState<string>("选择协议、动作和资产后执行交易。");
  const [rewards, setRewards] = useState<RewardRow[]>([]);
  const [isQueryingRewards, setIsQueryingRewards] = useState(false);

  const selectedProtocol = PROTOCOL_CAPABILITIES.find((item) => item.id === form.protocol) ?? PROTOCOL_CAPABILITIES[0];
  const selectedAsset = LENDING_ASSETS[form.asset];
  const canSubmit = Boolean(account?.address) && selectedProtocol.state !== "sdkBlocked" && !signAndExecute.isPending;

  const updateForm = <Key extends keyof typeof form>(key: Key, value: (typeof form)[Key]) => {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const updateProtocol = (protocolId: LendingProtocolId) => {
    const capability = PROTOCOL_CAPABILITIES.find((item) => item.id === protocolId);
    setForm((current) => ({
      ...current,
      protocol: protocolId,
      // 各协议支持的动作不同，切换协议时把不支持的动作重置为该协议的第一个动作。
      action:
        capability && !capability.actions.includes(current.action)
          ? capability.actions[0]
          : current.action,
    }));
  };

  const execute = async () => {
    if (!account?.address) {
      setStatus("请先连接 Sui 钱包。");
      return;
    }

    const adapter = lendingAdapters[form.protocol];
    if (!adapter) {
      setStatus("当前协议没有可用适配器。");
      return;
    }

    try {
      setStatus("正在用协议 SDK 构造交易...");
      const { tx, summary } = await adapter.buildTransaction({
        input: {
          ...form,
          address: account.address,
        },
      });

      setStatus("等待钱包签名...");
      const result = await signAndExecute.mutateAsync({
        transaction: tx,
      });

      const digest = "digest" in result ? result.digest : undefined;
      setStatus(digest ? `${summary} 已提交：${digest}` : `${summary} 已提交。`);
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "交易构造或执行失败");
    }
  };

  const queryRewards = async () => {
    if (!account?.address) {
      setStatus("请先连接 Sui 钱包。");
      return;
    }

    try {
      setIsQueryingRewards(true);
      const rows = (
        await Promise.all(
          PROTOCOL_CAPABILITIES.filter((item) => item.state === "ready")
            .map((item) => lendingAdapters[item.id]?.queryRewards?.(account.address) ?? Promise.resolve([])),
        )
      ).flat();
      setRewards(rows);
      setStatus(rows.length ? `查询到 ${rows.length} 条可展示激励。` : "当前未查询到可领取激励。");
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "激励查询失败");
    } finally {
      setIsQueryingRewards(false);
    }
  };

  return (
    <section className="rounded-lg border border-[#373A4D] bg-[#151722]/95">
      <div className="flex flex-col gap-3 border-b border-[#373A4D] p-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm text-[#8585B8]">Lending execution</p>
          <h2 className="text-xl font-semibold text-white">借贷聚合操作台</h2>
        </div>
        <ConnectButton />
      </div>

      <div className="grid gap-5 p-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="协议">
            <select
              className="control"
              value={form.protocol}
              onChange={(event) => updateProtocol(event.target.value as LendingProtocolId)}
            >
              {PROTOCOL_CAPABILITIES.map((protocol) => (
                <option key={protocol.id} value={protocol.id}>
                  {protocol.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="动作">
            <select
              className="control"
              value={form.action}
              onChange={(event) => updateForm("action", event.target.value as LendingAction)}
            >
              {selectedProtocol.actions.map((action) => (
                <option key={action} value={action}>
                  {LENDING_ACTION_LABELS[action]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="资产">
            <select
              className="control"
              value={form.asset}
              onChange={(event) => updateForm("asset", event.target.value as LendingAssetSymbol)}
              disabled={form.action === "claimRewards"}
            >
              {Object.values(LENDING_ASSETS).map((asset) => (
                <option key={asset.symbol} value={asset.symbol}>
                  {asset.symbol}
                </option>
              ))}
            </select>
          </Field>

          <Field label={`金额 ${selectedAsset.symbol}`}>
            <input
              className="control"
              inputMode="decimal"
              placeholder={form.action === "claimRewards" ? "领取激励无需金额" : "0.00"}
              value={form.amount}
              onChange={(event) => updateForm("amount", event.target.value)}
              disabled={form.action === "claimRewards"}
            />
          </Field>

          {form.protocol === "bluefin" ? (
            <Field label="Bluefin Position Cap ID" wide>
              <input
                className="control"
                placeholder="0x..."
                value={form.bluefinPositionCapId}
                onChange={(event) => updateForm("bluefinPositionCapId", event.target.value)}
              />
            </Field>
          ) : null}

          {form.protocol === "scallop" ? (
            <>
              <Field label="Scallop Obligation ID">
                <input
                  className="control"
                  placeholder="0x..."
                  value={form.scallopObligationId}
                  onChange={(event) => updateForm("scallopObligationId", event.target.value)}
                />
              </Field>
              <Field label="Scallop Obligation Key ID">
                <input
                  className="control"
                  placeholder="0x..."
                  value={form.scallopObligationKeyId}
                  onChange={(event) => updateForm("scallopObligationKeyId", event.target.value)}
                />
              </Field>
            </>
          ) : null}

        </div>

        <div className="flex flex-col gap-4 rounded-lg border border-[#373A4D] bg-[#0f111b] p-4">
          <div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-white">{selectedProtocol.name}</p>
              <span
                className={`rounded-md border px-2 py-1 text-xs font-semibold ${selectedProtocol.state === "ready"
                  ? "border-[#9FFFBF]/35 bg-[#9FFFBF]/10 text-[#9FFFBF]"
                  : "border-[#FFEA4B]/35 bg-[#FFEA4B]/10 text-[#FFEA4B]"
                  }`}
              >
                {selectedProtocol.state === "ready" ? "SDK ready" : "SDK blocked"}
              </span>
            </div>
            <p className="mt-2 text-sm text-[#a8a8c7]">{selectedProtocol.description}</p>
            {selectedProtocol.warning ? <p className="mt-2 text-sm text-[#FFEA4B]">{selectedProtocol.warning}</p> : null}
          </div>

          <div className="rounded-lg border border-[#373A4D] bg-[#151722] p-3">
            <p className="text-xs text-[#8585B8]">钱包地址</p>
            <p className="mt-1 break-all text-sm font-medium text-white">{account?.address ?? "未连接"}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className="h-10 rounded-lg border border-[#9FFFBF]/40 bg-[#9FFFBF]/10 px-4 text-sm font-semibold text-[#9FFFBF] transition hover:bg-[#9FFFBF]/15 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canSubmit}
              onClick={execute}
              type="button"
            >
              {signAndExecute.isPending ? "执行中" : "构造并签名执行"}
            </button>
            <button
              className="h-10 rounded-lg border border-[#373A4D] bg-[#232534] px-4 text-sm font-semibold text-white transition hover:border-[#7F7FFF] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!account?.address || isQueryingRewards}
              onClick={queryRewards}
              type="button"
            >
              {isQueryingRewards ? "查询中" : "查询激励"}
            </button>
          </div>

          <p className="min-h-10 rounded-lg border border-[#373A4D] bg-[#151722] p-3 text-sm text-[#dfdfed]">{status}</p>

          {rewards.length ? (
            <div className="space-y-2">
              {rewards.map((reward, index) => (
                <div key={`${reward.protocol}-${reward.label}-${index}`} className="rounded-lg border border-[#373A4D] bg-[#151722] p-3">
                  <p className="text-sm font-semibold text-white">{reward.label}</p>
                  <p className="mt-1 break-all text-xs text-[#a8a8c7]">
                    {formatTokenAmountText(reward.amount)} {reward.coinType ?? ""}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
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

  return (
    <section className="rounded-lg border border-[#373A4D] bg-[#151722]/95">
      <div className="flex flex-col gap-3 border-b border-[#373A4D] p-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm text-[#8585B8]">Wallet positions</p>
          <h2 className="text-xl font-semibold text-white">协议仓位</h2>
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
            className="h-10 rounded-lg border border-[#373A4D] bg-[#232534] px-4 text-sm font-semibold text-white transition hover:border-[#9FFFBF] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!address || loading}
            onClick={onRefresh}
            type="button"
          >
            {loading ? "查询中" : "刷新仓位"}
          </button>
        </div>
      </div>

      {!address ? (
        <div className="p-4 text-sm text-[#a8a8c7]">连接钱包后显示 Scallop、Bluefin Lend 和 NAVI 的 USDC 仓位。</div>
      ) : error ? (
        <div className="p-4 text-sm text-[#FF4D29]">仓位加载失败：{error}</div>
      ) : loading && !data ? (
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
          {skeletonPositions().map((position) => (
            <PositionCard key={position.id} position={position} loading />
          ))}
        </div>
      ) : positions.length ? (
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
          {positions.map((position) => (
            <PositionCard key={position.id} position={position} loading={false} onRefresh={onRefresh} />
          ))}
        </div>
      ) : (
        <div className="p-4">
          <p className="text-sm text-[#a8a8c7]">当前钱包没有查询到可展示的 Scallop / Bluefin Lend / NAVI USDC 仓位。</p>
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
      setActionStatus("请先连接 Sui 钱包。");
      return;
    }

    try {
      setIsBuilding(true);
      setActionStatus("正在构造交易...");
      const { buildPositionActionTransaction } = await import("@/lib/lending/position-actions");
      const { tx, summary } = await buildPositionActionTransaction({
        address: account.address,
        position,
        action,
        percent: action === "withdraw" ? withdrawPercent : undefined,
      });

      setActionStatus("等待钱包签名...");
      const result = await signAndExecute.mutateAsync({ transaction: tx });
      const digest = "digest" in result ? result.digest : undefined;
      setActionStatus(digest ? `${summary} 已提交：${digest}` : `${summary} 已提交。`);
      setShowWithdrawPanel(false);
      onRefresh?.();
    } catch (reason) {
      setActionStatus(reason instanceof Error ? reason.message : "交易构造或执行失败");
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
          <p className="text-xs text-[#8585B8]">资产</p>
          <p className="mt-1 truncate text-sm font-semibold text-white">{loading ? "--" : position.asset}</p>
        </div>
        <div>
          <p className="text-xs text-[#8585B8]">APR</p>
          <p className="mt-1 text-sm font-semibold text-[#FFEA4B]">{loading ? "--" : formatPercent(position.apr)}</p>
        </div>
      </div>

      <div className="mt-4">
        <p className="text-xs text-[#8585B8]">数量</p>
        <p className="mt-1 truncate text-lg font-semibold text-white">{loading ? "--" : position.amount}</p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs text-[#8585B8]">价值</p>
          <p className="mt-1 font-semibold text-[#9FFFBF]">{loading ? "--" : formatCurrency(position.valueUsd)}</p>
        </div>
        <div>
          <p className="text-xs text-[#8585B8]">奖励</p>
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
                取款
              </button>
            ) : null}
            <button
              className="h-9 rounded-lg border border-[#FFEA4B]/40 bg-[#FFEA4B]/10 px-3 text-sm font-semibold text-[#FFEA4B] transition hover:bg-[#FFEA4B]/15 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canOperate || !actionMeta.claimable}
              onClick={() => runAction("claimRewards")}
              type="button"
            >
              {actionMeta.claimable ? "领取激励" : "暂无激励"}
            </button>
          </div>

          {showWithdrawPanel && actionMeta.withdrawable ? (
            <div className="mt-3 rounded-lg border border-[#373A4D] bg-[#151722] p-3">
              <p className="text-xs text-[#8585B8]">取款比例</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {WITHDRAW_PERCENT_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    className={`h-8 rounded-md border px-2.5 text-xs font-semibold transition ${
                      withdrawPercent === preset
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
                {isBusy ? "执行中" : `确认取款 ${withdrawPercent}%`}
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
  loading,
}: {
  opportunity: YieldOpportunity;
  loading: boolean;
}) {
  const meta = PROTOCOL_META[opportunity.protocol];
  const barWidth = Math.min(Math.max(opportunity.apy ?? 0, 0), 60);

  return (
    <article className={`min-h-[252px] rounded-lg border border-[#373A4D] bg-[#151722]/95 p-4 ${meta.glow}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="grid size-10 place-items-center rounded-lg border border-[#373A4D] bg-[#1c1e2c] text-xs font-black text-[#0b0d14]"
            style={{ backgroundColor: meta.accent }}
          >
            {opportunity.protocolName.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <h3 className="font-semibold text-white">{opportunity.protocolName}</h3>
            <p className="text-xs text-[#8585B8]">{meta.label}</p>
          </div>
        </div>
        <QualityBadge status={loading ? "partial" : opportunity.status} />
      </div>

      <div className="mt-5">
        <p className="text-xs text-[#8585B8]">APY</p>
        <p className="mt-1 text-4xl font-semibold text-white">{loading ? "--" : formatPercent(opportunity.apy)}</p>
      </div>

      <div className="mt-4 h-2 rounded-md bg-[#232534]">
        <div
          className="h-2 rounded-md"
          style={{
            backgroundColor: meta.accent,
            width: `${loading ? 0 : barWidth}%`,
          }}
        />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs text-[#8585B8]">APR</p>
          <p className="font-semibold text-[#FFEA4B]">{loading ? "--" : formatPercent(opportunity.apr)}</p>
        </div>
        <div>
          <p className="text-xs text-[#8585B8]">TVL</p>
          <p className="font-semibold text-white">{loading ? "--" : formatCurrency(opportunity.tvlUsd)}</p>
        </div>
      </div>

      <div className="mt-4 rounded-md border border-[#373A4D] bg-[#0f111b] p-3 text-xs text-[#a8a8c7]">
        {loading ? "--" : breakdownLabel(opportunity)}
      </div>

      <p className="mt-4 min-h-10 text-sm text-[#a8a8c7]">{opportunity.product}</p>
    </article>
  );
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

function Field({
  children,
  label,
  wide = false,
}: {
  children: React.ReactNode;
  label: string;
  wide?: boolean;
}) {
  return (
    <label className={`flex flex-col gap-2 ${wide ? "md:col-span-2" : ""}`}>
      <span className="text-xs font-medium text-[#8585B8]">{label}</span>
      {children}
    </label>
  );
}

function skeletonProtocols(): YieldOpportunity[] {
  return (Object.keys(PROTOCOL_META) as ProtocolId[]).map((protocol) => ({
    id: `${protocol}-loading`,
    protocol,
    protocolName: PROTOCOL_NAMES[protocol],
    product: "Loading USDC market",
    asset: "USDC",
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
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

function sideLabel(side: UserLendingPosition["side"]) {
  return side === "supply" ? "存款" : "借款";
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
  if (item.ilRisk === "no" && item.exposure === "single") return "单资产";
  if (item.ilRisk === "yes") return "LP / IL";
  if (item.exposure === "multi") return "多资产";
  return item.ilRisk === "unknown" ? "未知" : item.ilRisk;
}
