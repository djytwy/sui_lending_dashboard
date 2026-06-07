import {
  PROTOCOL_NAMES,
  type DataQuality,
  type PositionsApiResponse,
  type ProtocolId,
  type UserLendingPosition,
} from "./yield-types";

const ALPHALEND_CACHE_TTL_MS = 60_000;
const POSITION_SOURCE_TIMEOUT_MS = 20_000;

type DecimalLike = {
  toString: () => string;
};

type AlphaLendRewardApr = {
  coinType: string;
  rewardApr: DecimalLike | number | string;
};

type AlphaLendMarketData = {
  marketId: string | number;
  coinType: string;
  price: DecimalLike | number | string;
  supplyApr: {
    interestApr: DecimalLike | number | string;
    stakingApr: DecimalLike | number | string;
    rewards: AlphaLendRewardApr[];
  };
  borrowApr: {
    interestApr: DecimalLike | number | string;
    rewards: AlphaLendRewardApr[];
  };
};

type AlphaLendPortfolio = {
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
    alphafi: "unavailable",
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

  const [alphaLendResult, scallopResult] = await Promise.allSettled([
    withTimeout(fetchAlphaLendPositions(normalizedAddress), POSITION_SOURCE_TIMEOUT_MS, "AlphaLend positions"),
    withTimeout(fetchScallopPositions(normalizedAddress), POSITION_SOURCE_TIMEOUT_MS, "Scallop positions"),
  ]);

  const positions: UserLendingPosition[] = [];

  if (alphaLendResult.status === "fulfilled") {
    sources.alphafi = alphaLendResult.value.status;
    sources.bluefin = alphaLendResult.value.status;
    positions.push(...alphaLendResult.value.positions);
    warnings.push(...alphaLendResult.value.warnings);
  } else {
    warnings.push(`AlphaLend positions failed: ${errorMessage(alphaLendResult.reason)}`);
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
    positions: positions.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0)),
    sources,
    warnings,
  };
}

async function fetchAlphaLendPositions(address: string): Promise<{
  positions: UserLendingPosition[];
  status: DataQuality;
  warnings: string[];
}> {
  const { AlphalendClient } = await import("@alphafi/alphalend-sdk");
  const client = new AlphalendClient("mainnet");
  const [markets, portfolios] = await Promise.all([
    client.getAllMarkets({ useCache: true, cacheTTL: ALPHALEND_CACHE_TTL_MS }),
    client.getUserPortfolio(address),
  ]);

  const marketMap = new Map<number, AlphaLendMarketData>();
  for (const market of ((markets ?? []) as AlphaLendMarketData[])) {
    marketMap.set(Number(market.marketId), market);
  }

  const alphaPositions = ((portfolios ?? []) as AlphaLendPortfolio[]).flatMap((portfolio) =>
    buildAlphaLendPortfolioRows(portfolio, marketMap, "alphafi"),
  );
  const bluefinPositions = ((portfolios ?? []) as AlphaLendPortfolio[]).flatMap((portfolio) =>
    buildAlphaLendPortfolioRows(portfolio, marketMap, "bluefin"),
  );

  return {
    positions: [...alphaPositions, ...bluefinPositions],
    status: "live",
    warnings: [
      "Bluefin Lend positions are displayed from AlphaLend SDK because Bluefin documents the lend product as an AlphaFi collaboration.",
    ],
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
      if (!lending || lending.suppliedCoin <= 0) continue;
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
        if (!collateral || collateral.depositedCoin <= 0) continue;
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
        if (!debt || debt.borrowedCoin <= 0) continue;
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

function buildAlphaLendPortfolioRows(
  portfolio: AlphaLendPortfolio,
  marketMap: Map<number, AlphaLendMarketData>,
  protocol: "alphafi" | "bluefin",
) {
  const rows: UserLendingPosition[] = [];
  const rewards = portfolio.rewardsToClaim.map((reward) => ({
    label: `${coinSymbolFromType(reward.coinType)} claimable`,
    amount: decimalToNumber(reward.rewardAmount).toString(),
    coinType: reward.coinType,
  }));
  const isBluefin = protocol === "bluefin";

  for (const [marketId, amountValue] of portfolio.suppliedAmounts.entries()) {
    const amount = decimalToNumber(amountValue);
    const market = marketMap.get(marketId);
    if (!market || amount <= 0) continue;
    const price = decimalToNumber(market.price);
    rows.push({
      id: `${protocol}-${portfolio.positionId}-supply-${marketId}`,
      protocol,
      protocolName: PROTOCOL_NAMES[protocol],
      product: `${coinSymbolFromType(market.coinType)} supply`,
      asset: coinSymbolFromType(market.coinType),
      side: "supply",
      amount: formatAmount(amount),
      valueUsd: numberOrNull(amount * price),
      apr: alphaSupplyApr(market),
      rewards,
      positionId: portfolio.positionId,
      url: isBluefin ? "https://trade.bluefin.io/lend" : "https://alphafi.xyz/",
      source: isBluefin ? "AlphaLend SDK via Bluefin Lend" : "AlphaLend SDK",
      status: "live",
      note: isBluefin
        ? "Same underlying AlphaLend position surfaced by Bluefin Lend."
        : "AlphaLend supplied collateral position.",
    });
  }

  for (const [marketId, amountValue] of portfolio.borrowedAmounts.entries()) {
    const amount = decimalToNumber(amountValue);
    const market = marketMap.get(marketId);
    if (!market || amount <= 0) continue;
    const price = decimalToNumber(market.price);
    rows.push({
      id: `${protocol}-${portfolio.positionId}-borrow-${marketId}`,
      protocol,
      protocolName: PROTOCOL_NAMES[protocol],
      product: `${coinSymbolFromType(market.coinType)} borrow`,
      asset: coinSymbolFromType(market.coinType),
      side: "borrow",
      amount: formatAmount(amount),
      valueUsd: numberOrNull(amount * price),
      apr: alphaBorrowApr(market),
      rewards,
      positionId: portfolio.positionId,
      url: isBluefin ? "https://trade.bluefin.io/lend" : "https://alphafi.xyz/",
      source: isBluefin ? "AlphaLend SDK via Bluefin Lend" : "AlphaLend SDK",
      status: "live",
      note: isBluefin
        ? "Same underlying AlphaLend borrow surfaced by Bluefin Lend."
        : "AlphaLend borrowed asset position.",
    });
  }

  return rows;
}

function alphaSupplyApr(market: AlphaLendMarketData) {
  return (
    decimalToNumber(market.supplyApr.interestApr) +
    decimalToNumber(market.supplyApr.stakingApr) +
    market.supplyApr.rewards.reduce((sum, reward) => sum + decimalToNumber(reward.rewardApr), 0)
  );
}

function alphaBorrowApr(market: AlphaLendMarketData) {
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
