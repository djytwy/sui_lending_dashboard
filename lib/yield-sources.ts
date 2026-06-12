import {
  PROTOCOL_NAMES,
  type DataQuality,
  type ProtocolId,
  type YieldApiResponse,
  type YieldOpportunity,
  type YieldRateBreakdown,
} from "./yield-types";

const REFRESH_INTERVAL_MS = 30_000;
const NATIVE_USDC_COIN_TYPE =
  "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";
const NAVI_POOLS_URL =
  "https://open-api.naviprotocol.io/api/navi/pools?env=prod&sdk=1.4.6&market=main";
const BLUEFIN_LEND_CACHE_TTL_MS = 60_000;

type DecimalLike = {
  toString: () => string;
};

type BluefinLendRewardApr = {
  coinType: string;
  rewardApr: DecimalLike | number | string;
};

type BluefinLendMarketData = {
  marketId: string | number;
  coinType: string;
  decimalDigit: number;
  totalSupply: DecimalLike | number | string;
  totalBorrow: DecimalLike | number | string;
  price: DecimalLike | number | string;
  utilizationRate: DecimalLike | number | string;
  supplyApr: {
    interestApr: DecimalLike | number | string;
    stakingApr: DecimalLike | number | string;
    rewards: BluefinLendRewardApr[];
  };
  borrowApr: {
    interestApr: DecimalLike | number | string;
    rewards: BluefinLendRewardApr[];
  };
};

type ScallopMarketPool = {
  coinName: string;
  symbol: string;
  coinType: string;
  supplyApr: number;
  supplyApy: number;
  borrowApr: number;
  borrowApy: number;
  supplyCoin: number;
  borrowCoin: number;
  utilizationRate: number;
  coinPrice: number;
};

type NaviPool = {
  id: number;
  uniqueId: string;
  suiCoinType: string;
  status: string;
  token?: {
    symbol?: string;
    decimals?: number;
    price?: number;
  };
  oracle?: {
    price?: string | number;
  };
  totalSupplyAmount?: string;
  borrowedAmount?: string;
  supplyIncentiveApyInfo?: NaviApyInfo;
  borrowIncentiveApyInfo?: NaviApyInfo;
  tags?: string[];
};

type NaviApyInfo = {
  vaultApr?: string;
  boostedApr?: string;
  rewardCoin?: string[];
  apy?: string;
  voloApy?: string;
  stakingYieldApy?: string;
  treasuryApy?: string;
  underlyingApy?: string;
};

type NaviPoolsResponse = {
  data?: NaviPool[];
  code?: number;
};

export async function getYieldDashboardData(): Promise<YieldApiResponse> {
  const warnings: string[] = [];
  const [scallopResult, bluefinResult, naviResult, suilendResult] = await Promise.allSettled([
    fetchScallopUsdcOpportunity(),
    fetchBluefinLendUsdcOpportunity(),
    fetchNaviUsdcOpportunity(),
    fetchSuilendUsdcOpportunity(),
  ]);

  const opportunities: YieldOpportunity[] = [];
  let scallopSdk: DataQuality = "unavailable";
  let naviOpenApi: DataQuality = "unavailable";
  let bluefinLend: DataQuality = "unavailable";
  let suilendSdk: DataQuality = "unavailable";

  if (scallopResult.status === "fulfilled") {
    scallopSdk = scallopResult.value.status;
    opportunities.push(scallopResult.value.opportunity);
    warnings.push(...scallopResult.value.warnings);
  } else {
    warnings.push(`Scallop SDK source failed: ${errorMessage(scallopResult.reason)}`);
    opportunities.push(unavailableOpportunity("scallop", "Scallop USDC lending pool"));
  }

  if (bluefinResult.status === "fulfilled") {
    bluefinLend = bluefinResult.value.status;
    opportunities.push(bluefinResult.value.opportunity);
    warnings.push(...bluefinResult.value.warnings);
  } else {
    warnings.push(`Bluefin Lend source failed: ${errorMessage(bluefinResult.reason)}`);
    opportunities.push(unavailableOpportunity("bluefin", "Bluefin Lend USDC market"));
  }

  if (naviResult.status === "fulfilled") {
    naviOpenApi = naviResult.value.status;
    opportunities.push(naviResult.value.opportunity);
    warnings.push(...naviResult.value.warnings);
  } else {
    warnings.push(`NAVI open-api source failed: ${errorMessage(naviResult.reason)}`);
    opportunities.push(unavailableOpportunity("navi", "NAVI USDC supply market"));
  }

  if (suilendResult.status === "fulfilled") {
    suilendSdk = suilendResult.value.status;
    opportunities.push(suilendResult.value.opportunity);
    warnings.push(...suilendResult.value.warnings);
  } else {
    warnings.push(`Suilend SDK source failed: ${errorMessage(suilendResult.reason)}`);
    opportunities.push(unavailableOpportunity("suilend", "Suilend USDC reserve"));
  }

  const deduped = dedupeByProtocol(opportunities)
    .map((item) => ({
      ...item,
      apr: normalizePercent(item.apr),
      apy: normalizePercent(item.apy),
      baseApy: normalizePercent(item.baseApy),
      rewardApy: normalizePercent(item.rewardApy),
      borrowApr: normalizePercent(item.borrowApr),
      utilization: normalizePercent(item.utilization),
      rateBreakdown: item.rateBreakdown.map((entry) => ({
        ...entry,
        value: normalizePercent(entry.value),
      })),
    }))
    .sort((a, b) => (b.apy ?? -1) - (a.apy ?? -1));

  return {
    generatedAt: new Date().toISOString(),
    refreshIntervalMs: REFRESH_INTERVAL_MS,
    chain: "Sui",
    asset: "Stablecoins",
    opportunities: deduped,
    sources: {
      scallopSdk,
      naviOpenApi,
      bluefinLend,
      suilendSdk,
    },
    warnings,
  };
}

async function fetchScallopUsdcOpportunity(): Promise<{
  opportunity: YieldOpportunity;
  status: DataQuality;
  warnings: string[];
}> {
  const { ScallopClient } = await import("@scallop-io/sui-scallop-sdk");
  const client = new ScallopClient({
    addressId: "695fcdc084f790c04eb068dc",
    networkType: "mainnet",
  });
  await client.init();

  const pool = (await client.query.getMarketPool("usdc", {
    indexer: true,
  })) as ScallopMarketPool | undefined;

  if (!pool) {
    return {
      opportunity: unavailableOpportunity("scallop", "Scallop USDC lending pool"),
      status: "unavailable",
      warnings: ["Scallop SDK did not return the USDC market pool."],
    };
  }

  const supplyApr = pool.supplyApr * 100;
  const supplyApy = pool.supplyApy * 100;
  const borrowApr = pool.borrowApr * 100;

  return {
    opportunity: {
      id: "scallop-usdc",
      protocol: "scallop",
      protocolName: PROTOCOL_NAMES.scallop,
      product: "USDC lending pool",
      asset: pool.symbol || "USDC",
      apr: supplyApr,
      apy: supplyApy,
      tvlUsd: numberOrNull(pool.supplyCoin * pool.coinPrice),
      baseApy: supplyApy,
      rewardApy: 0,
      borrowApr,
      utilization: pool.utilizationRate * 100,
      exposure: "single",
      ilRisk: "no",
      source: "Scallop SDK",
      poolId: pool.coinName,
      url: "https://app.scallop.io/",
      status: "live",
      note: "Pulled from Scallop SDK market pool data, matching the protocol market model used by app.scallop.io.",
      rateBreakdown: [
        { label: "Supply APR", value: supplyApr, kind: "base" },
        { label: "Supply APY", value: supplyApy, kind: "base" },
        { label: "Borrow APR", value: borrowApr, kind: "borrow" },
      ],
    },
    status: "live",
    warnings: [],
  };
}

async function fetchBluefinLendUsdcOpportunity(): Promise<{
  opportunity: YieldOpportunity;
  status: DataQuality;
  warnings: string[];
}> {
  const { AlphalendClient: BluefinLendClient } = await import("@alphafi/alphalend-sdk");
  const client = new BluefinLendClient("mainnet");
  const markets = ((await client.getAllMarkets({
    useCache: true,
    cacheTTL: BLUEFIN_LEND_CACHE_TTL_MS,
  })) ?? []) as BluefinLendMarketData[];

  const usdcMarket = markets.find(
    (market) => normalizeCoinType(market.coinType) === NATIVE_USDC_COIN_TYPE,
  );

  if (!usdcMarket) {
    return {
      opportunity: unavailableOpportunity("bluefin", "Bluefin Lend USDC market"),
      status: "unavailable",
      warnings: ["Bluefin Lend market source did not return the native USDC market."],
    };
  }

  return {
    opportunity: fromBluefinLendMarket(usdcMarket),
    status: "live",
    warnings: [],
  };
}

async function fetchNaviUsdcOpportunity(): Promise<{
  opportunity: YieldOpportunity;
  status: DataQuality;
  warnings: string[];
}> {
  const response = await fetch(NAVI_POOLS_URL, {
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    throw new Error(`NAVI open-api returned ${response.status}`);
  }

  const payload = (await response.json()) as NaviPoolsResponse;
  const pools = payload.data ?? [];
  const pool = selectNaviUsdcPool(pools);

  if (!pool) {
    return {
      opportunity: unavailableOpportunity("navi", "NAVI USDC supply market"),
      status: "unavailable",
      warnings: ["NAVI open-api did not return a USDC-related market."],
    };
  }

  const apyInfo = pool.supplyIncentiveApyInfo ?? {};
  const borrowInfo = pool.borrowIncentiveApyInfo ?? {};
  const totalApy = parsePercent(apyInfo.apy);
  const baseApy = parsePercent(apyInfo.vaultApr);
  const rewardApy = Math.max(
    0,
    (parsePercent(apyInfo.boostedApr) ?? 0) +
      (parsePercent(apyInfo.stakingYieldApy) ?? 0) +
      (parsePercent(apyInfo.treasuryApy) ?? 0) +
      (parsePercent(apyInfo.underlyingApy) ?? 0),
  );
  const borrowApr = parsePercent(borrowInfo.apy);
  const tokenSymbol = pool.token?.symbol || "USDC";
  const decimals = pool.token?.decimals ?? 6;
  const price = Number(pool.oracle?.price ?? pool.token?.price ?? 1);
  const supplyAmount = parseScaledNaviAmount(pool.totalSupplyAmount, decimals);

  return {
    opportunity: {
      id: `navi-${pool.uniqueId || pool.id}`,
      protocol: "navi",
      protocolName: PROTOCOL_NAMES.navi,
      product: `${tokenSymbol} supply market`,
      asset: tokenSymbol,
      apr: totalApy === null ? null : apyToApr(totalApy),
      apy: totalApy,
      tvlUsd: numberOrNull(supplyAmount * price),
      baseApy,
      rewardApy,
      borrowApr,
      utilization: calculateUtilization(pool.totalSupplyAmount, pool.borrowedAmount),
      exposure: "single",
      ilRisk: "no",
      source: "NAVI open-api",
      poolId: pool.uniqueId || String(pool.id),
      url: "https://app.naviprotocol.io/",
      status: pool.status === "active" ? "live" : "partial",
      note:
        tokenSymbol === "USDC"
          ? "Pulled from the same NAVI open-api pool fields used by the NAVI SDK."
          : `NAVI returned ${tokenSymbol} as the active USDC-related market for this source.`,
      rateBreakdown: buildNaviBreakdown(apyInfo, borrowInfo),
    },
    status: pool.status === "active" ? "live" : "partial",
    warnings: [],
  };
}

async function fetchSuilendUsdcOpportunity(): Promise<{
  opportunity: YieldOpportunity;
  status: DataQuality;
  warnings: string[];
}> {
  const [{ SuilendClient, LENDING_MARKET_ID, LENDING_MARKET_TYPE }, { SuiGrpcClient }, { parseReserve }] =
    await Promise.all([
      import("@suilend/sdk/client"),
      import("@mysten/sui/grpc"),
      import("@suilend/sdk/parsers/reserve"),
    ]);

  const grpcClient = new SuiGrpcClient({
    network: "mainnet",
    baseUrl: "https://fullnode.mainnet.sui.io:443",
  });
  const suilend = await SuilendClient.initialize(LENDING_MARKET_ID, LENDING_MARKET_TYPE, grpcClient);
  const reserve = suilend.lendingMarket.reserves.find(
    (item) => normalizeCoinType(item.coinType.name) === NATIVE_USDC_COIN_TYPE,
  );

  if (!reserve) {
    return {
      opportunity: unavailableOpportunity("suilend", "Suilend USDC reserve"),
      status: "unavailable",
      warnings: ["Suilend SDK did not return the native USDC reserve."],
    };
  }

  const coinTypes = new Set<string>([normalizeCoinType(reserve.coinType.name)]);
  for (const rewardManager of [reserve.depositsPoolRewardManager, reserve.borrowsPoolRewardManager]) {
    for (const poolReward of rewardManager.poolRewards) {
      if (poolReward) coinTypes.add(normalizeCoinType(poolReward.coinType.name));
    }
  }

  const metadataEntries = await Promise.all(
    Array.from(coinTypes).map(async (coinType) => {
      const { coinMetadata } = await grpcClient.getCoinMetadata({ coinType });
      return [coinType, coinMetadata] as const;
    }),
  );
  const coinMetadataMap = Object.fromEntries(
    metadataEntries.filter((entry): entry is [string, NonNullable<(typeof entry)[1]>] => entry[1] !== null),
  );
  if (!coinMetadataMap[normalizeCoinType(reserve.coinType.name)]) {
    return {
      opportunity: unavailableOpportunity("suilend", "Suilend USDC reserve"),
      status: "unavailable",
      warnings: ["Suilend SDK returned the USDC reserve, but Sui coin metadata was unavailable."],
    };
  }

  const parsedReserve = parseReserve(reserve, coinMetadataMap);
  const depositApr = decimalToNumber(parsedReserve.depositAprPercent);
  const borrowApr = decimalToNumber(parsedReserve.borrowAprPercent);
  const utilization = decimalToNumber(parsedReserve.utilizationPercent);
  const tvlUsd = decimalToNumber(parsedReserve.depositedAmountUsd);

  return {
    opportunity: {
      id: "suilend-usdc",
      protocol: "suilend",
      protocolName: PROTOCOL_NAMES.suilend,
      product: "Suilend USDC reserve",
      asset: parsedReserve.token.symbol || "USDC",
      apr: depositApr,
      apy: aprToApy(depositApr),
      tvlUsd: numberOrNull(tvlUsd),
      baseApy: depositApr,
      rewardApy: 0,
      borrowApr,
      utilization,
      exposure: "single",
      ilRisk: "no",
      source: "Suilend SDK",
      poolId: parsedReserve.id,
      url: "https://suilend.fi/",
      status: "live",
      note: "Pulled from the Suilend SDK lending market reserve, including current USDC deposit and borrow APR fields.",
      rateBreakdown: [
        { label: "Deposit APR", value: depositApr, kind: "base" },
        { label: "Deposit APY", value: aprToApy(depositApr), kind: "base" },
        { label: "Borrow APR", value: borrowApr, kind: "borrow" },
      ],
    },
    status: "live",
    warnings: [],
  };
}

function fromBluefinLendMarket(market: BluefinLendMarketData): YieldOpportunity {
  const baseApr = decimalToNumber(market.supplyApr.interestApr);
  const stakingApr = decimalToNumber(market.supplyApr.stakingApr);
  const rewardEntries = market.supplyApr.rewards.map((reward) => ({
    label: `${coinSymbolFromType(reward.coinType)} reward APR`,
    value: decimalToNumber(reward.rewardApr),
    kind: coinSymbolFromType(reward.coinType).toLowerCase() === "stsui" ? "staking" : "reward",
  })) satisfies YieldRateBreakdown[];
  const rewardApr = rewardEntries.reduce((sum, entry) => sum + (entry.value ?? 0), 0);
  const totalApr = baseApr + stakingApr + rewardApr;
  const borrowBaseApr = decimalToNumber(market.borrowApr.interestApr);
  const borrowRewardApr = market.borrowApr.rewards.reduce(
    (sum, reward) => sum + decimalToNumber(reward.rewardApr),
    0,
  );
  const borrowApr = borrowBaseApr - borrowRewardApr;
  const totalSupply = decimalToNumber(market.totalSupply);
  const price = decimalToNumber(market.price);

  return {
    id: "bluefin-lend-usdc",
    protocol: "bluefin",
    protocolName: PROTOCOL_NAMES.bluefin,
    product: "Bluefin Lend USDC market",
    asset: "USDC",
    apr: totalApr,
    apy: aprToApy(totalApr),
    tvlUsd: numberOrNull(totalSupply * price),
    baseApy: baseApr,
    rewardApy: rewardApr + stakingApr,
    borrowApr,
    utilization: decimalToNumber(market.utilizationRate) * 100,
    exposure: "single",
    ilRisk: "no",
    source: "Bluefin Lend market source",
    poolId: String(market.marketId),
    url: "https://trade.bluefin.io/lend",
    status: "live",
    note: "Pulled from the Bluefin Lend market integration, including staking and reward APR components.",
    rateBreakdown: [
      { label: "Base supply APR", value: baseApr, kind: "base" },
      ...(stakingApr > 0 ? [{ label: "Staking APR", value: stakingApr, kind: "staking" as const }] : []),
      ...rewardEntries,
      { label: "Net borrow APR", value: borrowApr, kind: "borrow" },
    ],
  };
}

function unavailableOpportunity(protocol: ProtocolId, product: string): YieldOpportunity {
  const isSuilend = protocol === "suilend";
  return {
    id: `${protocol}-unavailable`,
    protocol,
    protocolName: PROTOCOL_NAMES[protocol],
    product,
    asset: isSuilend ? "Stablecoins" : "USDC",
    apr: null,
    apy: null,
    tvlUsd: null,
    baseApy: null,
    rewardApy: null,
    borrowApr: null,
    utilization: null,
    exposure: "unknown",
    ilRisk: "unknown",
    source: "No live source",
    poolId: null,
    url: null,
    status: "unavailable",
    note: isSuilend
      ? "Suilend deposits are available through the SDK, but live stablecoin rate data is not configured yet."
      : "No live USDC lending data was returned by the configured protocol source.",
    rateBreakdown: [],
  };
}

function selectNaviUsdcPool(pools: NaviPool[]) {
  const active = pools.filter((pool) => pool.status === "active");
  const nativeUsdc = active.find((pool) => normalizeCoinType(pool.suiCoinType) === NATIVE_USDC_COIN_TYPE);
  if (nativeUsdc) return nativeUsdc;

  return active
    .filter((pool) => /USDC/i.test(pool.token?.symbol ?? "") || /usdc/i.test(pool.suiCoinType))
    .sort((a, b) => {
      const aNativeScore = normalizeCoinType(a.suiCoinType) === NATIVE_USDC_COIN_TYPE ? 1 : 0;
      const bNativeScore = normalizeCoinType(b.suiCoinType) === NATIVE_USDC_COIN_TYPE ? 1 : 0;
      if (aNativeScore !== bNativeScore) return bNativeScore - aNativeScore;
      return Number(b.totalSupplyAmount ?? 0) - Number(a.totalSupplyAmount ?? 0);
    })[0];
}

function buildNaviBreakdown(supply: NaviApyInfo, borrow: NaviApyInfo): YieldRateBreakdown[] {
  const entries: YieldRateBreakdown[] = [
    { label: "Base supply APY", value: parsePercent(supply.vaultApr), kind: "base" },
    { label: "Boosted reward APY", value: parsePercent(supply.boostedApr), kind: "reward" },
    { label: "Staking yield APY", value: parsePercent(supply.stakingYieldApy), kind: "staking" },
    { label: "Treasury APY", value: parsePercent(supply.treasuryApy), kind: "reward" },
    { label: "Underlying APY", value: parsePercent(supply.underlyingApy), kind: "base" },
    { label: "Borrow APY", value: parsePercent(borrow.apy), kind: "borrow" },
  ];

  return entries.filter((entry) => entry.value !== null && entry.value !== 0);
}

function dedupeByProtocol(opportunities: YieldOpportunity[]) {
  const byProtocol = new Map<ProtocolId, YieldOpportunity>();
  for (const opportunity of opportunities) {
    const current = byProtocol.get(opportunity.protocol);
    if (!current || (opportunity.apy ?? -1) > (current.apy ?? -1)) {
      byProtocol.set(opportunity.protocol, opportunity);
    }
  }

  for (const protocol of Object.keys(PROTOCOL_NAMES) as ProtocolId[]) {
    if (!byProtocol.has(protocol)) {
      byProtocol.set(protocol, unavailableOpportunity(protocol, protocol === "suilend" ? "Suilend stablecoin deposit adapter" : "USDC market"));
    }
  }

  return Array.from(byProtocol.values());
}

function calculateUtilization(totalSupplyAmount?: string, borrowedAmount?: string) {
  const supply = Number(totalSupplyAmount ?? 0);
  const borrowed = Number(borrowedAmount ?? 0);
  if (!Number.isFinite(supply) || supply <= 0) return null;
  return (borrowed / supply) * 100;
}

function parseScaledNaviAmount(value: string | undefined, decimals: number) {
  const raw = Number(value ?? 0);
  if (!Number.isFinite(raw)) return 0;
  return raw / 1_000_000_000 / 10 ** Math.max(decimals - 9, 0);
}

function decimalToNumber(value: DecimalLike | number | string | null | undefined) {
  if (value === null || value === undefined) return 0;
  const numeric = Number(typeof value === "object" ? value.toString() : value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function parsePercent(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function numberOrNull(value: number) {
  return Number.isFinite(value) ? value : null;
}

function normalizeCoinType(coinType: string) {
  if (coinType.startsWith("0x")) return coinType;
  return coinType
    .split("<")
    .map((segment) => {
      if (!segment || segment.startsWith("0x")) return segment;
      return `0x${segment}`;
    })
    .join("<");
}

function coinSymbolFromType(coinType: string) {
  if (coinType.includes("::usdsui::USDSUI")) return "USDSUI";
  if (coinType.includes("::usdt::USDT")) return "USDT";
  const symbol = coinType.split("::").at(-1) ?? coinType;
  return symbol.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function apyToApr(apy: number) {
  return (Math.pow(1 + apy / 100, 1 / 365) - 1) * 365 * 100;
}

function aprToApy(apr: number) {
  return (Math.pow(1 + apr / 100 / 365, 365) - 1) * 100;
}

function normalizePercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(4));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
