import {
  PROTOCOL_NAMES,
  type DataQuality,
  type ProtocolId,
  type YieldApiResponse,
  type YieldOpportunity,
} from "./yield-types";

const REFRESH_INTERVAL_MS = 30_000;
const DEFILLAMA_POOLS_URL = "https://yields.llama.fi/pools";
const SUI_GRAPHQL_URL = "https://graphql.mainnet.sui.io/graphql";
const ALPHAFI_MARKETS_TABLE_ID =
  "0x2326d387ba8bb7d24aa4cfa31f9a1e58bf9234b097574afb06c5dfb267df4c2e";
const NATIVE_USDC_COIN_TYPE =
  "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";
const ONE_E18 = BigInt("1000000000000000000");

type DefiLlamaPool = {
  chain: string;
  project: string;
  symbol: string;
  tvlUsd?: number;
  apyBase?: number | null;
  apyReward?: number | null;
  apy?: number | null;
  pool: string;
  stablecoin?: boolean;
  ilRisk?: string | null;
  exposure?: string | null;
  poolMeta?: string | null;
  underlyingTokens?: string[] | null;
  apyPct1D?: number | null;
  apyPct7D?: number | null;
  apyMean30d?: number | null;
};

type DefiLlamaResponse = {
  data: DefiLlamaPool[];
};

type AlphaFiMarketValue = {
  market_id: string;
  coin_type: string;
  xtoken_supply: string;
  borrowed_amount: string;
  writeoff_amount: string;
  balance_holding: string;
  unclaimed_spread_fee: string;
  unclaimed_spread_fee_protocol: string;
  decimal_digit: {
    value: string;
  };
  config: {
    active: boolean;
    interest_rate_kinks: string;
    interest_rates: string[];
    spread_fee_bps: string;
  };
};

type AlphaFiDynamicFieldNode = {
  address: string;
  name: {
    json: string;
  };
  value: {
    __typename: "MoveValue" | "MoveObject";
    json?: AlphaFiMarketValue;
    contents?: {
      json?: AlphaFiMarketValue;
    };
  };
};

type AlphaFiGraphqlResponse = {
  data?: {
    address?: {
      dynamicFields?: {
        nodes?: AlphaFiDynamicFieldNode[];
      };
    } | null;
  } | null;
  errors?: { message: string }[];
};

export async function getYieldDashboardData(): Promise<YieldApiResponse> {
  const warnings: string[] = [];
  const [defiLlamaResult, alphaFiResult] = await Promise.allSettled([
    fetchDefiLlamaOpportunities(),
    fetchAlphaFiUsdcOpportunity(),
  ]);

  let defiLlamaStatus: DataQuality = "unavailable";
  let suiGraphqlStatus: DataQuality = "unavailable";
  const opportunities: YieldOpportunity[] = [];

  if (defiLlamaResult.status === "fulfilled") {
    defiLlamaStatus = defiLlamaResult.value.status;
    opportunities.push(...defiLlamaResult.value.opportunities);
    warnings.push(...defiLlamaResult.value.warnings);
  } else {
    warnings.push(`DeFiLlama source failed: ${errorMessage(defiLlamaResult.reason)}`);
  }

  if (alphaFiResult.status === "fulfilled") {
    suiGraphqlStatus = alphaFiResult.value.status;
    opportunities.push(alphaFiResult.value.opportunity);
    warnings.push(...alphaFiResult.value.warnings);
  } else {
    warnings.push(`Sui GraphQL source failed: ${errorMessage(alphaFiResult.reason)}`);
    opportunities.push(unavailableOpportunity("alphafi", "AlphaLend USDC market"));
  }

  const deduped = dedupeByProtocol(opportunities)
    .map((item) => ({
      ...item,
      apr: normalizePercent(item.apr),
      apy: normalizePercent(item.apy),
      baseApy: normalizePercent(item.baseApy),
      rewardApy: normalizePercent(item.rewardApy),
      utilization: normalizePercent(item.utilization),
    }))
    .sort((a, b) => (b.apy ?? -1) - (a.apy ?? -1));

  return {
    generatedAt: new Date().toISOString(),
    refreshIntervalMs: REFRESH_INTERVAL_MS,
    chain: "Sui",
    asset: "USDC",
    opportunities: deduped,
    sources: {
      defiLlama: defiLlamaStatus,
      suiGraphql: suiGraphqlStatus,
    },
    warnings,
  };
}

async function fetchDefiLlamaOpportunities(): Promise<{
  opportunities: YieldOpportunity[];
  status: DataQuality;
  warnings: string[];
}> {
  const response = await fetch(DEFILLAMA_POOLS_URL, {
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    throw new Error(`DeFiLlama returned ${response.status}`);
  }

  const payload = (await response.json()) as DefiLlamaResponse;
  const suiUsdcPools = payload.data.filter(isSuiUsdcPool);
  const warnings: string[] = [];
  const opportunities: YieldOpportunity[] = [];

  const navi = selectSingleAssetPool(suiUsdcPools, "navi-lending");
  const scallop = selectSingleAssetPool(suiUsdcPools, "scallop-lend");
  const bluefin = selectBestPool(
    suiUsdcPools.filter((pool) => pool.project === "bluefin-spot"),
  );

  opportunities.push(
    navi
      ? fromDefiLlamaPool(navi, "navi", "USDC supply market")
      : unavailableOpportunity("navi", "USDC supply market"),
  );
  opportunities.push(
    scallop
      ? fromDefiLlamaPool(scallop, "scallop", "USDC lending pool")
      : unavailableOpportunity("scallop", "USDC lending pool"),
  );
  opportunities.push(
    bluefin
      ? fromDefiLlamaPool(bluefin, "bluefin", `${bluefin.symbol} LP pool`)
      : unavailableOpportunity("bluefin", "USDC liquidity pool"),
  );

  for (const protocol of ["navi", "scallop", "bluefin"] as ProtocolId[]) {
    if (opportunities.find((item) => item.protocol === protocol)?.status !== "live") {
      warnings.push(`${PROTOCOL_NAMES[protocol]} has no live Sui USDC pool in DeFiLlama.`);
    }
  }

  return {
    opportunities,
    status: opportunities.some((item) => item.status === "live") ? "live" : "unavailable",
    warnings,
  };
}

async function fetchAlphaFiUsdcOpportunity(): Promise<{
  opportunity: YieldOpportunity;
  status: DataQuality;
  warnings: string[];
}> {
  const query = `
    query AlphaFiMarkets($parent: SuiAddress!) {
      address(address: $parent) {
        dynamicFields(first: 50) {
          nodes {
            address
            name { json }
            value {
              __typename
              ... on MoveValue { json }
              ... on MoveObject {
                contents { json }
              }
            }
          }
        }
      }
    }
  `;

  const response = await fetch(SUI_GRAPHQL_URL, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables: {
        parent: ALPHAFI_MARKETS_TABLE_ID,
      },
    }),
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    throw new Error(`Sui GraphQL returned ${response.status}`);
  }

  const payload = (await response.json()) as AlphaFiGraphqlResponse;
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((item) => item.message).join("; "));
  }

  const nodes = payload.data?.address?.dynamicFields?.nodes ?? [];
  const usdcMarket = nodes
    .map((node) => ({
      node,
      value: node.value.json ?? node.value.contents?.json,
    }))
    .find(({ value }) => {
      return value?.config.active && normalizeCoinType(value.coin_type) === NATIVE_USDC_COIN_TYPE;
    });

  if (!usdcMarket?.value) {
    return {
      opportunity: unavailableOpportunity("alphafi", "AlphaLend USDC market"),
      status: "unavailable",
      warnings: ["AlphaFi active native USDC market was not found on Sui GraphQL."],
    };
  }

  const metrics = calculateAlphaFiSupplyMetrics(usdcMarket.value);

  return {
    opportunity: {
      id: "alphafi-usdc",
      protocol: "alphafi",
      protocolName: PROTOCOL_NAMES.alphafi,
      product: "AlphaLend USDC market",
      asset: "USDC",
      apr: metrics.supplyApr,
      apy: aprToApy(metrics.supplyApr),
      tvlUsd: metrics.totalSupply,
      baseApy: aprToApy(metrics.supplyApr),
      rewardApy: 0,
      utilization: metrics.utilization * 100,
      exposure: "single",
      ilRisk: "no",
      source: "Sui GraphQL",
      poolId: usdcMarket.value.market_id,
      url: "https://alphafi.xyz/",
      status: "live",
      note: "Native AlphaLend market data, APR calculated from on-chain utilization curve.",
    },
    status: "live",
    warnings: [],
  };
}

function fromDefiLlamaPool(
  pool: DefiLlamaPool,
  protocol: ProtocolId,
  fallbackProduct: string,
): YieldOpportunity {
  const apy = typeof pool.apy === "number" ? pool.apy : null;
  return {
    id: pool.pool,
    protocol,
    protocolName: PROTOCOL_NAMES[protocol],
    product: pool.poolMeta ? `${fallbackProduct} ${pool.poolMeta}` : fallbackProduct,
    asset: pool.symbol,
    apr: apy === null ? null : apyToApr(apy),
    apy,
    tvlUsd: typeof pool.tvlUsd === "number" ? pool.tvlUsd : null,
    baseApy: typeof pool.apyBase === "number" ? pool.apyBase : null,
    rewardApy: typeof pool.apyReward === "number" ? pool.apyReward : null,
    utilization: null,
    exposure: pool.exposure || (pool.stablecoin ? "single" : "multi"),
    ilRisk: pool.ilRisk || "unknown",
    source: "DeFiLlama Yields",
    poolId: pool.pool,
    url: `https://defillama.com/yields/pool/${pool.pool}`,
    status: "live",
    note: buildDefiLlamaNote(pool),
  };
}

function unavailableOpportunity(protocol: ProtocolId, product: string): YieldOpportunity {
  return {
    id: `${protocol}-unavailable`,
    protocol,
    protocolName: PROTOCOL_NAMES[protocol],
    product,
    asset: "USDC",
    apr: null,
    apy: null,
    tvlUsd: null,
    baseApy: null,
    rewardApy: null,
    utilization: null,
    exposure: "unknown",
    ilRisk: "unknown",
    source: "No live source",
    poolId: null,
    url: null,
    status: "unavailable",
    note: "No live USDC yield was returned by the configured source.",
  };
}

function isSuiUsdcPool(pool: DefiLlamaPool) {
  if (pool.chain !== "Sui") return false;
  const symbolHasUsdc = /\bW?USDC\b/i.test(pool.symbol);
  const tokenHasNativeUsdc = pool.underlyingTokens?.some(
    (token) => normalizeCoinType(token) === NATIVE_USDC_COIN_TYPE,
  );
  return Boolean(symbolHasUsdc || tokenHasNativeUsdc);
}

function selectSingleAssetPool(pools: DefiLlamaPool[], project: string) {
  const projectPools = pools.filter((pool) => pool.project === project);
  const exactNativeUsdc = projectPools.find(
    (pool) =>
      pool.symbol === "USDC" &&
      pool.underlyingTokens?.some((token) => normalizeCoinType(token) === NATIVE_USDC_COIN_TYPE),
  );

  if (exactNativeUsdc) return exactNativeUsdc;
  return selectBestPool(projectPools);
}

function selectBestPool(pools: DefiLlamaPool[]) {
  return pools
    .filter((pool) => typeof pool.apy === "number")
    .sort((a, b) => {
      const apyDelta = (b.apy ?? -1) - (a.apy ?? -1);
      if (apyDelta !== 0) return apyDelta;
      return (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0);
    })[0];
}

function calculateAlphaFiSupplyMetrics(market: AlphaFiMarketValue) {
  const totalLiquidityBase =
    BigInt(market.balance_holding) +
    BigInt(market.borrowed_amount) -
    BigInt(market.unclaimed_spread_fee) -
    BigInt(market.writeoff_amount) -
    BigInt(market.unclaimed_spread_fee_protocol);

  const decimalDigit = Number(BigInt(market.decimal_digit.value) / ONE_E18);
  const totalSupply = Number(totalLiquidityBase) / decimalDigit;
  const borrowed = Number(market.borrowed_amount) / decimalDigit;
  const utilization = totalSupply > 0 ? borrowed / totalSupply : 0;
  const borrowApr = calculateAlphaFiBorrowApr(utilization, market.config);
  const supplyApr =
    borrowApr * utilization * (1 - Number(market.config.spread_fee_bps) / 10_000);

  return {
    totalSupply,
    borrowed,
    utilization,
    borrowApr,
    supplyApr,
  };
}

function calculateAlphaFiBorrowApr(
  utilization: number,
  config: AlphaFiMarketValue["config"],
) {
  const kinks = Array.from(Buffer.from(config.interest_rate_kinks, "base64"));
  const rates = config.interest_rates.map(Number);

  if (kinks.length === 0) {
    return (rates[0] ?? 0) / 10_000;
  }

  const utilizationPercentage = utilization * 100;
  for (let index = 1; index < kinks.length; index += 1) {
    if (utilizationPercentage >= kinks[index]) continue;

    const leftApr = rates[index - 1] ?? 0;
    const rightApr = rates[index] ?? leftApr;
    const leftKink = kinks[index - 1] ?? 0;
    const rightKink = kinks[index] ?? 100;
    const interpolated =
      leftApr + ((rightApr - leftApr) * (utilizationPercentage - leftKink)) / (rightKink - leftKink);

    return interpolated / 100;
  }

  return (rates.at(-1) ?? 0) / 100;
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
      byProtocol.set(protocol, unavailableOpportunity(protocol, "USDC market"));
    }
  }

  return Array.from(byProtocol.values());
}

function buildDefiLlamaNote(pool: DefiLlamaPool) {
  const parts = [
    pool.apyPct1D === null || pool.apyPct1D === undefined
      ? null
      : `1d ${formatSigned(pool.apyPct1D)} pts`,
    pool.apyPct7D === null || pool.apyPct7D === undefined
      ? null
      : `7d ${formatSigned(pool.apyPct7D)} pts`,
    pool.apyMean30d === null || pool.apyMean30d === undefined
      ? null
      : `30d avg ${pool.apyMean30d.toFixed(2)}%`,
  ].filter(Boolean);

  return parts.length ? parts.join(" / ") : "Live Sui USDC yield pool.";
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

function formatSigned(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
