import {
  PROTOCOL_NAMES,
  type DataQuality,
  type PositionsApiResponse,
  type ProtocolId,
  type UserLendingPosition,
} from "./yield-types";
import { STABLECOIN_ASSETS } from "./lending/constants";
import type { LendingAssetSymbol } from "./lending/types";

const BLUEFIN_LEND_CACHE_TTL_MS = 60_000;
const POSITION_SOURCE_TIMEOUT_MS = 20_000;
const STABLECOIN_SYMBOLS = new Set<LendingAssetSymbol>(STABLECOIN_ASSETS.map((asset) => asset.symbol));
const STABLECOIN_COIN_TYPES = new Map(STABLECOIN_ASSETS.map((asset) => [normalizeCoinType(asset.coinType), asset.symbol]));
const SCALLOP_STABLECOIN_NAMES = new Map(
  STABLECOIN_ASSETS.flatMap((asset) => (asset.scallopCoinName ? [[asset.scallopCoinName, asset.symbol] as const] : [])),
);

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
  decimalDigit?: number;
  price: DecimalLike | number | string;
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

type BluefinLendPortfolio = {
  positionId: string;
  suppliedAmounts: Map<number, DecimalLike | number | string>;
  borrowedAmounts: Map<number, DecimalLike | number | string>;
  rewardsToClaim: {
    coinType: string;
    rewardAmount: DecimalLike | number | string;
  }[];
};

type ScallopLending = {
  coinName: string;
  symbol: string;
  coinType?: string;
  supplyApr: number;
  suppliedCoin: number;
  suppliedValue: number;
  stakedCoin: number;
  stakedValue: number;
  unstakedCoin: number;
  unstakedValue: number;
  stakedMarketAmount: number;
  unstakedMarketAmount: number;
  coinDecimal: number;
  availableClaimCoin: number;
};

type ScallopObligationAccount = {
  obligationId: string;
  collaterals?: Record<string, ScallopCollateral | undefined>;
  debts?: Record<string, ScallopDebt | undefined>;
  borrowIncentives?: Record<string, ScallopBorrowIncentive | undefined>;
};

type ScallopCollateral = {
  symbol: string;
  coinName: string;
  depositedCoin: number;
  depositedValue: number;
};

type ScallopDebt = {
  symbol: string;
  coinName: string;
  borrowedCoin: number;
  borrowedValue: number;
  rewards?: ScallopReward[];
};

type ScallopBorrowIncentive = {
  rewards?: ScallopReward[];
};

type ScallopReward = {
  symbol?: string;
  coinType?: string;
  availableClaimCoin?: number;
  availableClaimAmount?: number;
  boostedRewardApr?: number;
  baseRewardApr?: number;
};

export async function getPositionsDashboardData(address: string): Promise<PositionsApiResponse> {
  const normalizedAddress = address.trim();
  const warnings: string[] = [];
  const sources: Record<ProtocolId, DataQuality> = {
    navi: "unavailable",
    scallop: "unavailable",
    bluefin: "unavailable",
    suilend: "unavailable",
  };

  if (!/^0x[a-fA-F0-9]{64}$/.test(normalizedAddress)) {
    return {
      generatedAt: new Date().toISOString(),
      address: normalizedAddress,
      positions: [],
      sources,
      warnings: ["Invalid Sui address."],
    };
  }

  const [bluefinResult, scallopResult, suilendResult, naviResult] = await Promise.allSettled([
    withTimeout(fetchBluefinLendPositions(normalizedAddress), POSITION_SOURCE_TIMEOUT_MS, "Bluefin Lend positions"),
    withTimeout(fetchScallopPositions(normalizedAddress), POSITION_SOURCE_TIMEOUT_MS, "Scallop positions"),
    withTimeout(fetchSuilendPositions(normalizedAddress), POSITION_SOURCE_TIMEOUT_MS, "Suilend positions"),
    withTimeout(fetchNaviPositions(normalizedAddress), POSITION_SOURCE_TIMEOUT_MS, "NAVI positions"),
  ]);

  const positions: UserLendingPosition[] = [];

  if (bluefinResult.status === "fulfilled") {
    sources.bluefin = bluefinResult.value.status;
    positions.push(...bluefinResult.value.positions);
    warnings.push(...bluefinResult.value.warnings);
  } else {
    warnings.push(`Bluefin Lend positions failed: ${errorMessage(bluefinResult.reason)}`);
  }

  if (scallopResult.status === "fulfilled") {
    sources.scallop = scallopResult.value.status;
    positions.push(...scallopResult.value.positions);
    warnings.push(...scallopResult.value.warnings);
  } else {
    warnings.push(`Scallop positions failed: ${errorMessage(scallopResult.reason)}`);
  }

  if (suilendResult.status === "fulfilled") {
    sources.suilend = suilendResult.value.status;
    positions.push(...suilendResult.value.positions);
    warnings.push(...suilendResult.value.warnings);
  } else {
    warnings.push(`Suilend positions failed: ${errorMessage(suilendResult.reason)}`);
  }

  if (naviResult.status === "fulfilled") {
    sources.navi = naviResult.value.status;
    positions.push(...naviResult.value.positions);
    warnings.push(...naviResult.value.warnings);
  } else {
    warnings.push(`NAVI positions failed: ${errorMessage(naviResult.reason)}`);
  }

  return {
    generatedAt: new Date().toISOString(),
    address: normalizedAddress,
    positions: positions.filter(isStablecoinPosition).sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0)),
    sources,
    warnings,
  };
}

async function fetchBluefinLendPositions(address: string): Promise<{
  positions: UserLendingPosition[];
  status: DataQuality;
  warnings: string[];
}> {
  const { AlphalendClient: BluefinLendClient } = await import("@alphafi/alphalend-sdk");
  const client = new BluefinLendClient("mainnet");
  const [markets, portfolios] = await Promise.all([
    client.getAllMarkets({ useCache: true, cacheTTL: BLUEFIN_LEND_CACHE_TTL_MS }),
    client.getUserPortfolio(address),
  ]);

  const marketMap = new Map<number, BluefinLendMarketData>();
  for (const market of ((markets ?? []) as BluefinLendMarketData[])) {
    marketMap.set(Number(market.marketId), market);
  }

  const bluefinPositions = ((portfolios ?? []) as BluefinLendPortfolio[]).flatMap((portfolio) =>
    buildBluefinLendPortfolioRows(portfolio, marketMap),
  );

  return {
    positions: bluefinPositions,
    status: "live",
    warnings: [],
  };
}

async function fetchScallopPositions(address: string): Promise<{
  positions: UserLendingPosition[];
  status: DataQuality;
  warnings: string[];
}> {
  const { ScallopClient } = await import("@scallop-io/sui-scallop-sdk");
  const client = new ScallopClient({
    addressId: "695fcdc084f790c04eb068dc",
    networkType: "mainnet",
  });
  await client.init();

  const [lendingsResult, obligationAccountsResult] = await Promise.allSettled([
    client.query.getLendings(undefined, address, { indexer: true }) as Promise<Record<string, ScallopLending | undefined>>,
    client.query.getObligationAccounts(address, { indexer: true }) as Promise<Record<string, ScallopObligationAccount | undefined>>,
  ]);

  const positions: UserLendingPosition[] = [];
  const warnings: string[] = [];
  const poolAddresses = client.constants.poolAddresses;

  if (lendingsResult.status === "fulfilled") {
    for (const lending of Object.values(lendingsResult.value)) {
      if (!lending || lending.suppliedCoin <= 0) continue;
      const assetSymbol = stablecoinSymbolFromScallop(lending.symbol, lending.coinName, lending.coinType, poolAddresses);
      if (!assetSymbol) continue;
      const decimals = lending.coinDecimal ?? stablecoinDecimals(assetSymbol);
      positions.push({
        id: `scallop-lending-${lending.coinName}`,
        protocol: "scallop",
        protocolName: PROTOCOL_NAMES.scallop,
        product: `${assetSymbol} lending`,
        asset: assetSymbol,
        side: "supply",
        amount: formatAmount(lending.suppliedCoin),
        valueUsd: numberOrNull(lending.suppliedValue),
        apr: lending.supplyApr * 100,
        rewards:
          lending.availableClaimCoin > 0
            ? [{ label: "Scallop lending claimable", amount: formatAmount(lending.availableClaimCoin) }]
            : [],
        positionId: null,
        url: "https://app.scallop.io/",
        source: "Scallop SDK",
        status: "live",
        note:
          lending.stakedCoin > 0 || lending.unstakedCoin > 0
            ? `Includes ${formatAmount(lending.stakedCoin)} staked and ${formatAmount(lending.unstakedCoin)} unstaked.`
            : "Wallet sCoin lending position.",
        action: {
          withdrawable: true,
          claimable: lending.availableClaimCoin > 0,
          decimals,
          scallop: {
            kind: "lending",
            coinName: lending.coinName,
            sCoinName: `s${lending.coinName}`,
            stakedMarketAmount: lending.stakedMarketAmount ?? 0,
            unstakedMarketAmount: lending.unstakedMarketAmount ?? 0,
          },
        },
      });
    }
  } else {
    warnings.push(`Scallop lending balances failed: ${errorMessage(lendingsResult.reason)}`);
  }

  if (obligationAccountsResult.status === "fulfilled") {
    for (const account of Object.values(obligationAccountsResult.value)) {
      if (!account) continue;
      for (const collateral of Object.values(account.collaterals ?? {})) {
        if (!collateral || collateral.depositedCoin <= 0) continue;
        const assetSymbol = stablecoinSymbolFromScallop(collateral.symbol, collateral.coinName, undefined, poolAddresses);
        if (!assetSymbol) continue;
        const decimals = stablecoinDecimals(assetSymbol);
        positions.push({
          id: `scallop-collateral-${account.obligationId}-${collateral.coinName}`,
          protocol: "scallop",
          protocolName: PROTOCOL_NAMES.scallop,
          product: `${assetSymbol} collateral`,
          asset: assetSymbol,
          side: "supply",
          amount: formatAmount(collateral.depositedCoin),
          valueUsd: numberOrNull(collateral.depositedValue),
          apr: null,
          rewards: collectScallopRewards(account),
          positionId: account.obligationId,
          url: "https://app.scallop.io/",
          source: "Scallop SDK",
          status: "live",
          note: "Collateral deposited in a Scallop obligation.",
          action: {
            withdrawable: true,
            claimable: collectScallopRewards(account).length > 0,
            decimals,
            baseAmount: decimalToBaseUnits(collateral.depositedCoin, decimals),
            scallop: {
              kind: "collateral",
              coinName: collateral.coinName,
              obligationId: account.obligationId,
            },
          },
        });
      }

      for (const debt of Object.values(account.debts ?? {})) {
        if (!debt || debt.borrowedCoin <= 0) continue;
        const assetSymbol = stablecoinSymbolFromScallop(debt.symbol, debt.coinName, undefined, poolAddresses);
        if (!assetSymbol) continue;
        const decimals = stablecoinDecimals(assetSymbol);
        const rewardApr = (debt.rewards ?? []).reduce(
          (sum, reward) => sum + (reward.boostedRewardApr ?? reward.baseRewardApr ?? 0),
          0,
        );
        positions.push({
          id: `scallop-debt-${account.obligationId}-${debt.coinName}`,
          protocol: "scallop",
          protocolName: PROTOCOL_NAMES.scallop,
          product: `${assetSymbol} debt`,
          asset: assetSymbol,
          side: "borrow",
          amount: formatAmount(debt.borrowedCoin),
          valueUsd: numberOrNull(debt.borrowedValue),
          apr: rewardApr ? rewardApr * -100 : null,
          rewards: (debt.rewards ?? [])
            .filter((reward) => (reward.availableClaimCoin ?? 0) > 0)
            .map((reward) => ({
              label: `${reward.symbol ?? "Reward"} borrow incentive`,
              amount: formatAmount(reward.availableClaimCoin ?? 0),
              coinType: reward.coinType,
            })),
          positionId: account.obligationId,
          url: "https://app.scallop.io/",
          source: "Scallop SDK",
          status: "live",
          note: "Borrowed asset in a Scallop obligation.",
          action: {
            withdrawable: false,
            claimable: (debt.rewards ?? []).some((reward) => (reward.availableClaimCoin ?? 0) > 0),
            decimals,
            scallop: {
              kind: "debt",
              coinName: debt.coinName,
              obligationId: account.obligationId,
            },
          },
        });
      }
    }
  } else {
    warnings.push(`Scallop obligation accounts failed: ${errorMessage(obligationAccountsResult.reason)}`);
  }

  return {
    positions,
    status: warnings.length ? "partial" : "live",
    warnings,
  };
}

async function fetchSuilendPositions(address: string): Promise<{
  positions: UserLendingPosition[];
  status: DataQuality;
  warnings: string[];
}> {
  const [{ SuilendClient, LENDING_MARKET_ID, LENDING_MARKET_TYPE }, { SuiGrpcClient }, suilendInitialize] =
    await Promise.all([
      import("@suilend/sdk/client"),
      import("@mysten/sui/grpc"),
      import("@suilend/sdk/lib/initialize"),
    ]);

  const grpcClient = new SuiGrpcClient({
    network: "mainnet",
    baseUrl: "https://fullnode.mainnet.sui.io:443",
  });
  const client = await SuilendClient.initialize(LENDING_MARKET_ID, LENDING_MARKET_TYPE, grpcClient);
  const { refreshedRawReserves, reserveMap } = await suilendInitialize.initializeSuilend(grpcClient, client);
  const { obligations, strategyObligations } = await suilendInitialize.initializeObligations(
    grpcClient,
    client,
    refreshedRawReserves,
    reserveMap,
    address,
  );

  const positions: UserLendingPosition[] = [];
  for (const obligation of [...obligations, ...strategyObligations]) {
    for (const deposit of obligation.deposits) {
      const assetSymbol = stablecoinSymbolFromCoinType(deposit.coinType);
      if (!assetSymbol) continue;
      const amount = bigNumberToNumber(deposit.depositedAmount);
      if (amount <= 0) continue;
      const valueUsd = numberOrNull(bigNumberToNumber(deposit.depositedAmountUsd));
      const decimals = deposit.reserve.mintDecimals ?? stablecoinDecimals(assetSymbol);

      positions.push({
        id: `suilend-${obligation.id}-deposit-${String(deposit.reserveArrayIndex)}`,
        protocol: "suilend",
        protocolName: PROTOCOL_NAMES.suilend,
        product: `${assetSymbol} deposit`,
        asset: assetSymbol,
        side: "supply",
        amount: formatAmount(amount),
        valueUsd,
        apr: numberOrNull(bigNumberToNumber(deposit.reserve.depositAprPercent)),
        rewards: [],
        positionId: obligation.id,
        url: "https://app.suilend.fi/",
        source: "Suilend SDK",
        status: "live",
        note: "Suilend obligation deposit position.",
        action: {
          withdrawable: true,
          claimable: false,
          decimals,
          baseAmount: decimalToBaseUnits(bigNumberToPlainString(deposit.depositedAmount), decimals),
        },
      });
    }
  }

  return {
    positions,
    status: "live",
    warnings: [],
  };
}

async function fetchNaviPositions(address: string): Promise<{
  positions: UserLendingPosition[];
  status: DataQuality;
  warnings: string[];
}> {
  const { getLendingPositions } = await import("@naviprotocol/lending");
  const lendingPositions = await getLendingPositions(address, {
    cacheTime: 60_000,
    env: "prod",
  });

  const positions: UserLendingPosition[] = [];
  for (const position of lendingPositions) {
    if (position.type === "navi-lending-supply" && position["navi-lending-supply"]) {
      const supply = position["navi-lending-supply"];
      const assetSymbol = stablecoinSymbolFromCoinType(supply.token.coinType);
      if (!assetSymbol) continue;
      positions.push({
        id: position.id,
        protocol: "navi",
        protocolName: PROTOCOL_NAMES.navi,
        product: `${assetSymbol} supply`,
        asset: assetSymbol,
        side: "supply",
        amount: formatAmount(decimalToNumber(supply.amount)),
        valueUsd: numberOrNull(decimalToNumber(supply.valueUSD)),
        apr: naviSupplyApr(supply.pool),
        rewards: [],
        positionId: position.id,
        url: "https://app.naviprotocol.io/",
        source: "NAVI beta SDK",
        status: "live",
        note: `NAVI ${position.market} supply position.`,
      });
    }

    if (position.type === "navi-lending-emode-supply" && position["navi-lending-emode-supply"]) {
      const supply = position["navi-lending-emode-supply"];
      const assetSymbol = stablecoinSymbolFromCoinType(supply.token.coinType);
      if (!assetSymbol) continue;
      positions.push({
        id: position.id,
        protocol: "navi",
        protocolName: PROTOCOL_NAMES.navi,
        product: `${assetSymbol} eMode supply`,
        asset: assetSymbol,
        side: "supply",
        amount: formatAmount(decimalToNumber(supply.amount)),
        valueUsd: numberOrNull(decimalToNumber(supply.valueUSD)),
        apr: naviSupplyApr(supply.pool),
        rewards: [],
        positionId: position.id,
        url: "https://app.naviprotocol.io/",
        source: "NAVI beta SDK",
        status: "live",
        note: `NAVI ${position.market} eMode supply position.`,
      });
    }
  }

  return {
    positions,
    status: "live",
    warnings: [],
  };
}

function buildBluefinLendPortfolioRows(
  portfolio: BluefinLendPortfolio,
  marketMap: Map<number, BluefinLendMarketData>,
) {
  const rows: UserLendingPosition[] = [];
  const rewards = portfolio.rewardsToClaim.map((reward) => ({
    label: `${coinSymbolFromType(reward.coinType)} claimable`,
    amount: formatAmount(decimalToNumber(reward.rewardAmount)),
    coinType: reward.coinType,
  }));

  for (const [marketId, amountValue] of portfolio.suppliedAmounts.entries()) {
    const amount = decimalToNumber(amountValue);
    const market = marketMap.get(marketId);
    if (!market || amount <= 0) continue;
    const assetSymbol = stablecoinSymbolFromCoinType(market.coinType);
    if (!assetSymbol) continue;
    const price = decimalToNumber(market.price);
    const decimals = market.decimalDigit ?? stablecoinDecimals(assetSymbol);
    rows.push({
      id: `bluefin-${portfolio.positionId}-supply-${marketId}`,
      protocol: "bluefin",
      protocolName: PROTOCOL_NAMES.bluefin,
      product: `${assetSymbol} supply`,
      asset: assetSymbol,
      side: "supply",
      amount: formatAmount(amount),
      valueUsd: numberOrNull(amount * price),
      apr: bluefinSupplyApr(market),
      rewards,
      positionId: portfolio.positionId,
      url: "https://trade.bluefin.io/lend",
      source: "Bluefin Lend position source",
      status: "live",
      note: "Bluefin Lend supplied collateral position.",
      action: {
        withdrawable: true,
        claimable: rewards.length > 0,
        decimals,
        baseAmount: decimalToBaseUnits(amountValue, decimals),
        bluefin: {
          marketId: String(marketId),
          coinType: market.coinType,
        },
      },
    });
  }

  for (const [marketId, amountValue] of portfolio.borrowedAmounts.entries()) {
    const amount = decimalToNumber(amountValue);
    const market = marketMap.get(marketId);
    if (!market || amount <= 0) continue;
    const assetSymbol = stablecoinSymbolFromCoinType(market.coinType);
    if (!assetSymbol) continue;
    const price = decimalToNumber(market.price);
    const decimals = market.decimalDigit ?? stablecoinDecimals(assetSymbol);
    rows.push({
      id: `bluefin-${portfolio.positionId}-borrow-${marketId}`,
      protocol: "bluefin",
      protocolName: PROTOCOL_NAMES.bluefin,
      product: `${assetSymbol} borrow`,
      asset: assetSymbol,
      side: "borrow",
      amount: formatAmount(amount),
      valueUsd: numberOrNull(amount * price),
      apr: bluefinBorrowApr(market),
      rewards,
      positionId: portfolio.positionId,
      url: "https://trade.bluefin.io/lend",
      source: "Bluefin Lend position source",
      status: "live",
      note: "Bluefin Lend borrowed asset position.",
      action: {
        withdrawable: false,
        claimable: rewards.length > 0,
        decimals,
        bluefin: {
          marketId: String(marketId),
          coinType: market.coinType,
        },
      },
    });
  }

  return rows;
}

function bluefinSupplyApr(market: BluefinLendMarketData) {
  return (
    decimalToNumber(market.supplyApr.interestApr) +
    decimalToNumber(market.supplyApr.stakingApr) +
    market.supplyApr.rewards.reduce((sum, reward) => sum + decimalToNumber(reward.rewardApr), 0)
  );
}

function bluefinBorrowApr(market: BluefinLendMarketData) {
  return (
    decimalToNumber(market.borrowApr.interestApr) -
    market.borrowApr.rewards.reduce((sum, reward) => sum + decimalToNumber(reward.rewardApr), 0)
  );
}

function naviSupplyApr(pool: { currentSupplyRate?: string; supplyIncentiveApyInfo?: { apy?: string | number } }) {
  const baseRate = decimalToNumber(pool.currentSupplyRate);
  const baseApr = baseRate > 1_000 ? baseRate / 1e27 * 100 : baseRate;
  const incentiveApr = decimalToNumber(pool.supplyIncentiveApyInfo?.apy);
  return numberOrNull(baseApr + incentiveApr);
}

function collectScallopRewards(account: ScallopObligationAccount) {
  return Object.values(account.borrowIncentives ?? {})
    .flatMap((incentive) => incentive?.rewards ?? [])
    .filter((reward) => (reward.availableClaimCoin ?? 0) > 0)
    .map((reward) => ({
      label: `${reward.symbol ?? "Reward"} claimable`,
      amount: formatAmount(reward.availableClaimCoin ?? 0),
      coinType: reward.coinType,
    }));
}

function decimalToNumber(value: DecimalLike | number | string | null | undefined) {
  if (value === null || value === undefined) return 0;
  const numeric = Number(typeof value === "object" ? value.toString() : value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function bigNumberToNumber(value: DecimalLike | number | string | null | undefined) {
  return decimalToNumber(value);
}

function bigNumberToPlainString(value: DecimalLike | number | string) {
  if (typeof value === "object" && "toFixed" in value && typeof value.toFixed === "function") {
    return value.toFixed();
  }
  return typeof value === "object" ? value.toString() : String(value);
}

function numberOrNull(value: number) {
  return Number.isFinite(value) ? value : null;
}

function formatAmount(value: number) {
  if (!Number.isFinite(value)) return "0.00";
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

function decimalToBaseUnits(value: DecimalLike | number | string, decimals: number) {
  let normalized = String(typeof value === "object" ? value.toString() : value).replace(/,/g, "").trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    const numeric = Number(normalized);
    if (!Number.isFinite(numeric) || numeric <= 0) return "0";
    normalized = numeric.toFixed(decimals);
  }

  const [whole, fraction = ""] = normalized.split(".");
  const padded = fraction.padEnd(decimals, "0").slice(0, decimals);
  return (BigInt(whole || "0") * BigInt(10) ** BigInt(decimals) + BigInt(padded || "0")).toString();
}

function coinSymbolFromType(coinType: string) {
  const stablecoinSymbol = stablecoinSymbolFromCoinType(coinType);
  if (stablecoinSymbol) return stablecoinSymbol;
  if (coinType.includes("DEEPBOOK_STAKED")) return "DB-USDC";
  const symbol = coinType.split("::").at(-1) ?? coinType;
  return symbol.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function isStablecoinPosition(position: UserLendingPosition) {
  return isStablecoinSymbol(position.asset);
}

function stablecoinSymbolFromScallop(
  symbol: string | undefined,
  coinName: string | undefined,
  coinType: string | undefined,
  poolAddresses: Record<string, { coinType?: string; coinName?: string } | undefined>,
): LendingAssetSymbol | null {
  const byCoinType =
    coinType !== undefined
      ? STABLECOIN_COIN_TYPES.get(normalizeCoinType(coinType)) ?? resolveScallopPoolSymbolByCoinType(coinType, poolAddresses)
      : undefined;
  if (byCoinType) return byCoinType;

  const mapped = coinName ? SCALLOP_STABLECOIN_NAMES.get(coinName.trim().toLowerCase()) : undefined;
  if (mapped) return mapped;
  const normalizedSymbol = symbol?.trim().toUpperCase();
  return isStablecoinSymbol(normalizedSymbol) ? normalizedSymbol : null;
}

function resolveScallopPoolSymbolByCoinType(
  coinType: string,
  poolAddresses: Record<string, { coinType?: string; coinName?: string } | undefined>,
): LendingAssetSymbol | null {
  const normalizedTarget = normalizeCoinType(coinType);
  for (const [coinName, pool] of Object.entries(poolAddresses)) {
    if (!pool?.coinType) continue;
    if (normalizeCoinType(pool.coinType) !== normalizedTarget) continue;
    const normalizedCoinName = coinName.trim().toLowerCase();
    if (normalizedCoinName === "usdc" || normalizedCoinName === "usdt" || normalizedCoinName === "usdsui") {
      return normalizedCoinName.toUpperCase() as LendingAssetSymbol;
    }
  }
  return null;
}

function stablecoinSymbolFromCoinType(coinType: string) {
  return STABLECOIN_COIN_TYPES.get(normalizeCoinType(coinType)) ?? null;
}

function isStablecoinSymbol(symbol: string | undefined): symbol is LendingAssetSymbol {
  return STABLECOIN_SYMBOLS.has((symbol ?? "").trim().toUpperCase() as LendingAssetSymbol);
}

function stablecoinDecimals(symbol: LendingAssetSymbol) {
  return STABLECOIN_ASSETS.find((asset) => asset.symbol === symbol)?.decimals ?? 6;
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}
