import {
  PROTOCOL_NAMES,
  type DataQuality,
  type PositionsApiResponse,
  type ProtocolId,
  type UserLendingPosition,
} from "./yield-types";

const BLUEFIN_LEND_CACHE_TTL_MS = 60_000;
const POSITION_SOURCE_TIMEOUT_MS = 20_000;
const NATIVE_USDC_COIN_TYPE =
  "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";

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
  supplyApr: number;
  suppliedCoin: number;
  suppliedValue: number;
  stakedCoin: number;
  stakedValue: number;
  unstakedCoin: number;
  unstakedValue: number;
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

  const [bluefinResult, scallopResult] = await Promise.allSettled([
    withTimeout(fetchBluefinLendPositions(normalizedAddress), POSITION_SOURCE_TIMEOUT_MS, "Bluefin Lend positions"),
    withTimeout(fetchScallopPositions(normalizedAddress), POSITION_SOURCE_TIMEOUT_MS, "Scallop positions"),
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

  warnings.push(
    "NAVI positions are not queried yet because @naviprotocol/lending@1.4.6 is incompatible with the installed @mysten/sui v2 client; NAVI rates use open-api instead.",
  );

  return {
    generatedAt: new Date().toISOString(),
    address: normalizedAddress,
    positions: positions.filter(isUsdcPosition).sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0)),
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

  if (lendingsResult.status === "fulfilled") {
    for (const lending of Object.values(lendingsResult.value)) {
      if (!lending || lending.suppliedCoin <= 0 || !isScallopUsdcAsset(lending.symbol, lending.coinName)) continue;
      positions.push({
        id: `scallop-lending-${lending.coinName}`,
        protocol: "scallop",
        protocolName: PROTOCOL_NAMES.scallop,
        product: `${lending.symbol} lending`,
        asset: lending.symbol,
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
      });
    }
  } else {
    warnings.push(`Scallop lending balances failed: ${errorMessage(lendingsResult.reason)}`);
  }

  if (obligationAccountsResult.status === "fulfilled") {
    for (const account of Object.values(obligationAccountsResult.value)) {
      if (!account) continue;
      for (const collateral of Object.values(account.collaterals ?? {})) {
        if (!collateral || collateral.depositedCoin <= 0 || !isScallopUsdcAsset(collateral.symbol, collateral.coinName)) continue;
        positions.push({
          id: `scallop-collateral-${account.obligationId}-${collateral.coinName}`,
          protocol: "scallop",
          protocolName: PROTOCOL_NAMES.scallop,
          product: `${collateral.symbol} collateral`,
          asset: collateral.symbol,
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
        });
      }

      for (const debt of Object.values(account.debts ?? {})) {
        if (!debt || debt.borrowedCoin <= 0 || !isScallopUsdcAsset(debt.symbol, debt.coinName)) continue;
        const rewardApr = (debt.rewards ?? []).reduce(
          (sum, reward) => sum + (reward.boostedRewardApr ?? reward.baseRewardApr ?? 0),
          0,
        );
        positions.push({
          id: `scallop-debt-${account.obligationId}-${debt.coinName}`,
          protocol: "scallop",
          protocolName: PROTOCOL_NAMES.scallop,
          product: `${debt.symbol} debt`,
          asset: debt.symbol,
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

function buildBluefinLendPortfolioRows(
  portfolio: BluefinLendPortfolio,
  marketMap: Map<number, BluefinLendMarketData>,
) {
  const rows: UserLendingPosition[] = [];
  const rewards = portfolio.rewardsToClaim.map((reward) => ({
    label: `${coinSymbolFromType(reward.coinType)} claimable`,
    amount: decimalToNumber(reward.rewardAmount).toString(),
    coinType: reward.coinType,
  }));

  for (const [marketId, amountValue] of portfolio.suppliedAmounts.entries()) {
    const amount = decimalToNumber(amountValue);
    const market = marketMap.get(marketId);
    if (!market || amount <= 0 || !isNativeUsdcCoinType(market.coinType)) continue;
    const price = decimalToNumber(market.price);
    rows.push({
      id: `bluefin-${portfolio.positionId}-supply-${marketId}`,
      protocol: "bluefin",
      protocolName: PROTOCOL_NAMES.bluefin,
      product: `${coinSymbolFromType(market.coinType)} supply`,
      asset: coinSymbolFromType(market.coinType),
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
    });
  }

  for (const [marketId, amountValue] of portfolio.borrowedAmounts.entries()) {
    const amount = decimalToNumber(amountValue);
    const market = marketMap.get(marketId);
    if (!market || amount <= 0 || !isNativeUsdcCoinType(market.coinType)) continue;
    const price = decimalToNumber(market.price);
    rows.push({
      id: `bluefin-${portfolio.positionId}-borrow-${marketId}`,
      protocol: "bluefin",
      protocolName: PROTOCOL_NAMES.bluefin,
      product: `${coinSymbolFromType(market.coinType)} borrow`,
      asset: coinSymbolFromType(market.coinType),
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

function numberOrNull(value: number) {
  return Number.isFinite(value) ? value : null;
}

function formatAmount(value: number) {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 1) return value.toLocaleString("en-US", { maximumFractionDigits: 6 });
  return value.toLocaleString("en-US", { maximumFractionDigits: 9 });
}

function coinSymbolFromType(coinType: string) {
  if (coinType.includes("::usdc::USDC")) return "USDC";
  if (coinType.includes("DEEPBOOK_STAKED")) return "DB-USDC";
  const symbol = coinType.split("::").at(-1) ?? coinType;
  return symbol.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function isUsdcPosition(position: UserLendingPosition) {
  return isUsdcSymbol(position.asset);
}

function isScallopUsdcAsset(symbol: string | undefined, coinName: string | undefined) {
  return isUsdcSymbol(symbol) || coinName?.trim().toLowerCase() === "usdc";
}

function isNativeUsdcCoinType(coinType: string) {
  return normalizeCoinType(coinType) === NATIVE_USDC_COIN_TYPE;
}

function isUsdcSymbol(symbol: string | undefined) {
  return symbol?.trim().toUpperCase() === "USDC";
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
