import {
  PROTOCOL_NAMES,
  type DataQuality,
  type ProtocolId,
  type YieldApiResponse,
  type YieldOpportunity,
  type YieldRateBreakdown,
} from "./yield-types";
import {
  LENDING_ASSETS,
  STABLECOIN_ASSET_SYMBOLS,
} from "./lending/constants";
import type { LendingAssetSymbol } from "./lending/types";

const REFRESH_INTERVAL_MS = 30_000;
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
    fetchScallopStablecoinOpportunities(),
    fetchBluefinLendStablecoinOpportunities(),
    fetchNaviStablecoinOpportunities(),
    fetchSuilendStablecoinOpportunities(),
  ]);

  const opportunities: YieldOpportunity[] = [];
  let scallopSdk: DataQuality = "unavailable";
  let naviOpenApi: DataQuality = "unavailable";
  let bluefinLend: DataQuality = "unavailable";
  let suilendSdk: DataQuality = "unavailable";

  if (scallopResult.status === "fulfilled") {
    scallopSdk = scallopResult.value.status;
    opportunities.push(...scallopResult.value.opportunities);
    warnings.push(...scallopResult.value.warnings);
  } else {
    warnings.push(`Scallop SDK source failed: ${errorMessage(scallopResult.reason)}`);
    opportunities.push(...unavailableStablecoinOpportunities("scallop"));
  }

  if (bluefinResult.status === "fulfilled") {
    bluefinLend = bluefinResult.value.status;
    opportunities.push(...bluefinResult.value.opportunities);
    warnings.push(...bluefinResult.value.warnings);
  } else {
    warnings.push(`Bluefin Lend source failed: ${errorMessage(bluefinResult.reason)}`);
    opportunities.push(...unavailableStablecoinOpportunities("bluefin"));
  }

  if (naviResult.status === "fulfilled") {
    naviOpenApi = naviResult.value.status;
    opportunities.push(...naviResult.value.opportunities);
    warnings.push(...naviResult.value.warnings);
  } else {
    warnings.push(`NAVI open-api source failed: ${errorMessage(naviResult.reason)}`);
    opportunities.push(...unavailableStablecoinOpportunities("navi"));
  }

  if (suilendResult.status === "fulfilled") {
    suilendSdk = suilendResult.value.status;
    opportunities.push(...suilendResult.value.opportunities);
    warnings.push(...suilendResult.value.warnings);
  } else {
    warnings.push(`Suilend SDK source failed: ${errorMessage(suilendResult.reason)}`);
    opportunities.push(...unavailableStablecoinOpportunities("suilend"));
  }

  const normalized = fillMissingStablecoinOpportunities(opportunities)
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
    .sort((a, b) => {
      const protocolDiff = protocolSortIndex(a.protocol) - protocolSortIndex(b.protocol);
      if (protocolDiff !== 0) return protocolDiff;
      return assetSortIndex(a.asset) - assetSortIndex(b.asset);
    });

  return {
    generatedAt: new Date().toISOString(),
    refreshIntervalMs: REFRESH_INTERVAL_MS,
    chain: "Sui",
    asset: "Stablecoins",
    opportunities: normalized,
    sources: {
      scallopSdk,
      naviOpenApi,
      bluefinLend,
      suilendSdk,
    },
    warnings,
  };
}

async function fetchScallopStablecoinOpportunities(): Promise<{
  opportunities: YieldOpportunity[];
  status: DataQuality;
  warnings: string[];
}> {
  const { ScallopClient } = await import("@scallop-io/sui-scallop-sdk");
  const client = new ScallopClient({
    addressId: "695fcdc084f790c04eb068dc",
    networkType: "mainnet",
  });
  await client.init();

  const opportunities: YieldOpportunity[] = [];
  const warnings: string[] = [];

  for (const asset of STABLECOIN_ASSET_SYMBOLS) {
    const coinNames = resolveScallopMarketCoinNames(asset, client.constants.poolAddresses);
    let pool: ScallopMarketPool | undefined;
    for (const coinName of coinNames) {
      pool = (await client.query.getMarketPool(coinName, {
        indexer: true,
      })) as ScallopMarketPool | undefined;
      if (pool) break;
    }

    if (!pool) {
      warnings.push(`Scallop SDK did not return the ${asset} market pool. Tried keys: ${coinNames.join(", ") || asset.toLowerCase()}.`);
      continue;
    }

    const supplyApr = pool.supplyApr * 100;
    const supplyApy = pool.supplyApy * 100;
    const borrowApr = pool.borrowApr * 100;

    opportunities.push({
      id: `scallop-${asset.toLowerCase()}`,
      protocol: "scallop",
      protocolName: PROTOCOL_NAMES.scallop,
      product: `${asset} lending pool`,
      asset,
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
    });
  }

  return {
    opportunities,
    status: sourceStatus(opportunities),
    warnings,
  };
}

async function fetchBluefinLendStablecoinOpportunities(): Promise<{
  opportunities: YieldOpportunity[];
  status: DataQuality;
  warnings: string[];
}> {
  const { AlphalendClient: BluefinLendClient } = await import("@alphafi/alphalend-sdk");
  const client = new BluefinLendClient("mainnet");
  const markets = ((await client.getAllMarkets({
    useCache: true,
    cacheTTL: BLUEFIN_LEND_CACHE_TTL_MS,
  })) ?? []) as BluefinLendMarketData[];

  const opportunities: YieldOpportunity[] = [];
  const warnings: string[] = [];

  for (const asset of STABLECOIN_ASSET_SYMBOLS) {
    const market = markets.find(
      (item) => normalizeCoinType(item.coinType) === normalizeCoinType(LENDING_ASSETS[asset].coinType),
    );
    if (!market) {
      warnings.push(`Bluefin Lend market source did not return the ${asset} market.`);
      continue;
    }
    opportunities.push(fromBluefinLendMarket(market, asset));
  }

  return {
    opportunities,
    status: sourceStatus(opportunities),
    warnings,
  };
}

async function fetchNaviStablecoinOpportunities(): Promise<{
  opportunities: YieldOpportunity[];
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
  const opportunities: YieldOpportunity[] = [];
  const warnings: string[] = [];

  for (const asset of STABLECOIN_ASSET_SYMBOLS) {
    const pool = selectNaviPool(pools, asset);
    if (!pool) {
      warnings.push(`NAVI open-api did not return a ${asset} market.`);
      continue;
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
    const tokenSymbol = pool.token?.symbol || asset;
    const decimals = pool.token?.decimals ?? LENDING_ASSETS[asset].decimals;
    const price = Number(pool.oracle?.price ?? pool.token?.price ?? 1);
    const supplyAmount = parseScaledNaviAmount(pool.totalSupplyAmount, decimals);

    opportunities.push({
      id: `navi-${asset.toLowerCase()}-${pool.uniqueId || pool.id}`,
      protocol: "navi",
      protocolName: PROTOCOL_NAMES.navi,
      product: `${asset} supply market`,
      asset,
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
        tokenSymbol.toUpperCase() === asset
          ? "Pulled from the same NAVI open-api pool fields used by the NAVI SDK."
          : `NAVI returned ${tokenSymbol} for the configured ${asset} market source.`,
      rateBreakdown: buildNaviBreakdown(apyInfo, borrowInfo),
    });
  }

  return {
    opportunities,
    status: sourceStatus(opportunities),
    warnings,
  };
}

async function fetchSuilendStablecoinOpportunities(): Promise<{
  opportunities: YieldOpportunity[];
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
  const reserveEntries = STABLECOIN_ASSET_SYMBOLS.map((asset) => ({
    asset,
    reserve: suilend.lendingMarket.reserves.find(
      (item) => normalizeCoinType(item.coinType.name) === normalizeCoinType(LENDING_ASSETS[asset].coinType),
    ),
  }));
  const warnings = reserveEntries
    .filter((entry) => !entry.reserve)
    .map((entry) => `Suilend SDK did not return the ${entry.asset} reserve.`);
  const reserves = reserveEntries.filter(
    (entry): entry is { asset: LendingAssetSymbol; reserve: NonNullable<(typeof entry)["reserve"]> } =>
      entry.reserve !== undefined,
  );

  const coinTypes = new Set<string>();
  for (const { reserve } of reserves) {
    coinTypes.add(normalizeCoinType(reserve.coinType.name));
    for (const rewardManager of [reserve.depositsPoolRewardManager, reserve.borrowsPoolRewardManager]) {
      for (const poolReward of rewardManager.poolRewards) {
        if (poolReward) coinTypes.add(normalizeCoinType(poolReward.coinType.name));
      }
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
  const opportunities: YieldOpportunity[] = [];

  for (const { asset, reserve } of reserves) {
    if (!coinMetadataMap[normalizeCoinType(reserve.coinType.name)]) {
      warnings.push(`Suilend SDK returned the ${asset} reserve, but Sui coin metadata was unavailable.`);
      continue;
    }

    const parsedReserve = parseReserve(reserve, coinMetadataMap);
    const depositApr = decimalToNumber(parsedReserve.depositAprPercent);
    const borrowApr = decimalToNumber(parsedReserve.borrowAprPercent);
    const utilization = decimalToNumber(parsedReserve.utilizationPercent);
    const tvlUsd = decimalToNumber(parsedReserve.depositedAmountUsd);

    opportunities.push({
      id: `suilend-${asset.toLowerCase()}`,
      protocol: "suilend",
      protocolName: PROTOCOL_NAMES.suilend,
      product: `Suilend ${asset} reserve`,
      asset,
      apr: depositApr,
      apy: aprToApy(depositApr),
      tvlUsd: numberOrNull(tvlUsd),
      baseApy: aprToApy(depositApr),
      rewardApy: 0,
      borrowApr,
      utilization,
      exposure: "single",
      ilRisk: "no",
      source: "Suilend SDK",
      poolId: parsedReserve.id,
      url: "https://suilend.fi/",
      status: "live",
      note: "Pulled from the Suilend SDK lending market reserve, including current deposit and borrow APR fields.",
      rateBreakdown: [
        { label: "Deposit APR", value: depositApr, kind: "base" },
        { label: "Deposit APY", value: aprToApy(depositApr), kind: "base" },
        { label: "Borrow APR", value: borrowApr, kind: "borrow" },
      ],
    });
  }

  return {
    opportunities,
    status: sourceStatus(opportunities),
    warnings,
  };
}

function fromBluefinLendMarket(market: BluefinLendMarketData, asset: LendingAssetSymbol): YieldOpportunity {
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
    id: `bluefin-lend-${asset.toLowerCase()}`,
    protocol: "bluefin",
    protocolName: PROTOCOL_NAMES.bluefin,
    product: `Bluefin Lend ${asset} market`,
    asset,
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
  const asset = stablecoinAssetFromProduct(product);
  return {
    id: `${protocol}-${(asset ?? "stablecoins").toLowerCase()}-unavailable`,
    protocol,
    protocolName: PROTOCOL_NAMES[protocol],
    product,
    asset: asset ?? "Stablecoins",
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
    note: "No live stablecoin lending data was returned by the configured protocol source.",
    rateBreakdown: [],
  };
}

function unavailableStablecoinOpportunities(protocol: ProtocolId) {
  return STABLECOIN_ASSET_SYMBOLS.map((asset) =>
    unavailableOpportunity(protocol, `${PROTOCOL_NAMES[protocol]} ${asset} market`),
  );
}

function resolveScallopMarketCoinNames(
  asset: LendingAssetSymbol,
  poolAddresses: Record<string, { coinType?: string; coinName?: string } | undefined>,
) {
  const names = new Set<string>();
  const assetMeta = LENDING_ASSETS[asset];
  const normalizedTarget = normalizeCoinType(assetMeta.coinType);

  if (assetMeta.scallopCoinName) names.add(assetMeta.scallopCoinName);
  for (const [coinName, pool] of Object.entries(poolAddresses)) {
    if (!pool?.coinType) continue;
    if (normalizeCoinType(pool.coinType) === normalizedTarget) {
      names.add(pool.coinName ?? coinName);
    }
  }

  names.add(asset.toLowerCase());
  if (asset === "USDT") {
    names.add("sbusdt");
    names.add("wusdt");
  }
  if (asset === "USDSUI") {
    names.add("usdsui");
    names.add("susdsui");
  }

  return Array.from(names);
}

function selectNaviPool(pools: NaviPool[], asset: LendingAssetSymbol) {
  const active = pools.filter((pool) => pool.status === "active");
  const exactCoinType = active.find(
    (pool) => normalizeCoinType(pool.suiCoinType) === normalizeCoinType(LENDING_ASSETS[asset].coinType),
  );
  if (exactCoinType) return exactCoinType;

  return active
    .filter((pool) => new RegExp(asset, "i").test(pool.token?.symbol ?? "") || new RegExp(asset, "i").test(pool.suiCoinType))
    .sort((a, b) => {
      const aNativeScore = normalizeCoinType(a.suiCoinType) === normalizeCoinType(LENDING_ASSETS[asset].coinType) ? 1 : 0;
      const bNativeScore = normalizeCoinType(b.suiCoinType) === normalizeCoinType(LENDING_ASSETS[asset].coinType) ? 1 : 0;
      if (aNativeScore !== bNativeScore) return bNativeScore - aNativeScore;
      return Number(b.totalSupplyAmount ?? 0) - Number(a.totalSupplyAmount ?? 0);
    })[0];
}

function fillMissingStablecoinOpportunities(opportunities: YieldOpportunity[]) {
  const byKey = new Map(opportunities.map((item) => [`${item.protocol}:${item.asset.toUpperCase()}`, item]));
  for (const protocol of Object.keys(PROTOCOL_NAMES) as ProtocolId[]) {
    for (const asset of STABLECOIN_ASSET_SYMBOLS) {
      const key = `${protocol}:${asset}`;
      if (!byKey.has(key)) {
        byKey.set(key, unavailableOpportunity(protocol, `${PROTOCOL_NAMES[protocol]} ${asset} market`));
      }
    }
  }
  return Array.from(byKey.values());
}

function sourceStatus(opportunities: YieldOpportunity[]) {
  if (
    opportunities.length === STABLECOIN_ASSET_SYMBOLS.length &&
    opportunities.every((opportunity) => opportunity.status === "live")
  ) {
    return "live";
  }
  return opportunities.length > 0 ? "partial" : "unavailable";
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

function protocolSortIndex(protocol: ProtocolId) {
  return (Object.keys(PROTOCOL_NAMES) as ProtocolId[]).indexOf(protocol);
}

function assetSortIndex(asset: string) {
  const index = STABLECOIN_ASSET_SYMBOLS.indexOf(asset.toUpperCase() as LendingAssetSymbol);
  return index === -1 ? STABLECOIN_ASSET_SYMBOLS.length : index;
}

function stablecoinAssetFromProduct(product: string) {
  const normalized = product.toUpperCase();
  return STABLECOIN_ASSET_SYMBOLS.find((asset) => normalized.includes(asset)) ?? null;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
