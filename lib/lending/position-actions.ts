import type { Transaction } from "@mysten/sui/transactions";
import type { UserLendingPosition } from "@/lib/yield-types";
import type { BuildLendingTransactionResult } from "./types";

const SCALLOP_ADDRESS_ID = "695fcdc084f790c04eb068dc";
const MAX_U64 = BigInt("18446744073709551615");

export type PositionAction = "withdraw" | "claimRewards";

export type PositionActionRequest = {
  address: string;
  position: UserLendingPosition;
  action: PositionAction;
  /** Withdrawal percentage (1-100), required when action is withdraw. */
  percent?: number;
};

/** Convert the formatted position-card amount, possibly with thousands separators, into base units. */
function parsePositionAmountToBaseUnits(formatted: string, decimals: number): bigint {
  const cleaned = formatted.replace(/,/g, "").trim();
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    throw new Error(`Unable to parse position amount: ${formatted}`);
  }
  const [whole, fraction = ""] = cleaned.split(".");
  const padded = fraction.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(whole || "0") * BigInt(10) ** BigInt(decimals) + BigInt(padded || "0");
}

function getPositionAmountBaseUnits(position: UserLendingPosition, decimals: number): bigint {
  const baseAmount = position.action?.baseAmount;
  if (baseAmount !== undefined) {
    if (!/^\d+$/.test(baseAmount)) {
      throw new Error("Invalid raw position amount format");
    }
    return BigInt(baseAmount);
  }
  return parsePositionAmountToBaseUnits(position.amount, decimals);
}

function requirePercent(request: PositionActionRequest): number {
  const percent = request.percent ?? 0;
  if (!Number.isFinite(percent) || percent < 1 || percent > 100) {
    throw new Error("Withdrawal percentage must be between 1 and 100");
  }
  return Math.floor(percent);
}

async function createScallopClient() {
  const { ScallopClient } = await import("@scallop-io/sui-scallop-sdk");
  const client = new ScallopClient({
    addressId: SCALLOP_ADDRESS_ID,
    networkType: "mainnet",
  });
  await client.init();
  return client;
}

async function resolveScallopObligationKeyId(
  client: Awaited<ReturnType<typeof createScallopClient>>,
  address: string,
  obligationId: string,
) {
  const obligations = await client.getObligations(address);
  const obligation = obligations.find((item) => item.id === obligationId);
  if (!obligation) {
    throw new Error("Scallop obligation was not found, so ownership could not be verified");
  }
  if (obligation.locked) {
    throw new Error("This Scallop obligation is staked and locked. Unstake it on the Scallop app before continuing");
  }
  return obligation.keyId;
}

async function buildScallopPositionTransaction(
  request: PositionActionRequest,
): Promise<Transaction> {
  const { address, position, action } = request;
  const meta = position.action?.scallop;
  if (!meta) {
    throw new Error("Missing Scallop position metadata");
  }
  const client = await createScallopClient();

  if (meta.kind === "lending") {
    if (action === "claimRewards") {
      return (await client.claim(meta.sCoinName ?? `s${meta.coinName}`, false, undefined, address)) as Transaction;
    }

    // Withdrawals are calculated in market coin (sCoin) base units and rounded down by percentage.
    const percent = requirePercent(request);
    const staked = Math.max(0, Math.floor(meta.stakedMarketAmount ?? 0));
    const unstaked = Math.max(0, Math.floor(meta.unstakedMarketAmount ?? 0));
    const total = staked + unstaked;
    if (total <= 0) {
      throw new Error("This position has no withdrawable shares");
    }
    const need = percent === 100 ? total : Math.floor((total * percent) / 100);
    if (need <= 0) {
      throw new Error("The withdrawal percentage converts to 0 amount. Increase the percentage");
    }
    const unstakedUse = Math.min(need, unstaked);
    const stakedUse = need - unstakedUse;

    const txBlock = client.builder.createTxBlock();
    txBlock.setSender(address);
    if (stakedUse > 0) {
      const marketCoin = await txBlock.unstakeQuick(stakedUse, meta.sCoinName ?? `s${meta.coinName}`, undefined, false);
      if (!marketCoin) {
        throw new Error("The Scallop spool does not have enough staked shares to unstake");
      }
      const coin = txBlock.withdraw(marketCoin, meta.coinName);
      txBlock.transferObjects([coin], address);
    }
    if (unstakedUse > 0) {
      const coin = await txBlock.withdrawQuick(unstakedUse, meta.coinName);
      txBlock.transferObjects([coin], address);
    }
    return txBlock.txBlock;
  }

  // Collateral and debt positions are attached to an obligation; resolve keyId automatically.
  const obligationId = meta.obligationId;
  if (!obligationId) {
    throw new Error("Missing Scallop obligation ID");
  }
  const obligationKeyId = await resolveScallopObligationKeyId(client, address, obligationId);

  if (action === "claimRewards") {
    return (await client.claimBorrowIncentive(obligationId, obligationKeyId, false, address)) as Transaction;
  }

  if (meta.kind === "debt") {
    throw new Error("Borrow positions cannot be withdrawn. Use repay instead");
  }

  const percent = requirePercent(request);
  const decimals = position.action?.decimals ?? 6;
  const totalBase = getPositionAmountBaseUnits(position, decimals);
  const amountBase =
    percent === 100 ? totalBase : (totalBase * BigInt(percent)) / BigInt(100);
  const amountNumber = Number(amountBase);
  if (!Number.isSafeInteger(amountNumber) || amountNumber <= 0) {
    throw new Error("Withdrawal amount is invalid or exceeds the safe integer range");
  }
  return (await client.withdrawCollateral(
    meta.coinName,
    amountNumber,
    false,
    obligationId,
    obligationKeyId,
    address,
  )) as Transaction;
}

async function buildBluefinPositionTransaction(
  request: PositionActionRequest,
): Promise<Transaction> {
  const { address, position, action } = request;
  const meta = position.action?.bluefin;
  if (!meta) {
    throw new Error("Missing Bluefin position metadata");
  }

  const { AlphalendClient: BluefinLendClient, getUserPositionCapId } = await import("@alphafi/alphalend-sdk");
  const client = new BluefinLendClient("mainnet");
  const positionCapId = await getUserPositionCapId(client.blockchain, address);
  if (!positionCapId) {
    throw new Error("No Bluefin Position Cap was found in this wallet, so the position cannot be operated");
  }

  if (action === "claimRewards") {
    const tx = await client.claimRewards({
      address,
      positionCapId,
      // Claim to the wallet without redepositing.
      claimAndDepositAll: false,
      claimAndDepositAlpha: false,
    });
    if (!tx) {
      throw new Error("Bluefin Lend did not return a transaction. There may be no claimable rewards");
    }
    return tx;
  }

  const percent = requirePercent(request);
  const decimals = position.action?.decimals ?? 6;
  const totalBase = getPositionAmountBaseUnits(position, decimals);
  // For 100%, use the SDK MAX_U64 sentinel to withdraw all and avoid dust from accrued interest.
  const amount = percent === 100 ? MAX_U64 : (totalBase * BigInt(percent)) / BigInt(100);
  if (amount <= BigInt(0)) {
    throw new Error("The withdrawal percentage converts to 0 amount. Increase the percentage");
  }

  // Risk checks require fresh oracle prices for every asset involved in the position.
  const priceUpdateCoinTypes = new Set<string>([meta.coinType]);
  try {
    const [markets, portfolios] = await Promise.all([
      client.getAllMarkets({ useCache: true, cacheTTL: 60_000 }),
      client.getUserPortfolio(address),
    ]);
    const marketCoinTypes = new Map<string, string>();
    for (const market of markets ?? []) {
      marketCoinTypes.set(String(market.marketId), market.coinType);
    }
    for (const portfolio of portfolios ?? []) {
      for (const marketId of [...portfolio.suppliedAmounts.keys(), ...portfolio.borrowedAmounts.keys()]) {
        const coinType = marketCoinTypes.get(String(marketId));
        if (coinType) priceUpdateCoinTypes.add(coinType);
      }
    }
  } catch {
    // If the full position cannot be loaded, fall back to updating only this asset price.
  }

  const tx = await client.withdraw({
    address,
    amount,
    coinType: meta.coinType,
    marketId: meta.marketId,
    positionCapId,
    priceUpdateCoinTypes: [...priceUpdateCoinTypes],
  });
  if (!tx) {
    throw new Error("Bluefin Lend did not return a withdrawal transaction");
  }
  return tx;
}

export async function buildPositionActionTransaction(
  request: PositionActionRequest,
): Promise<BuildLendingTransactionResult> {
  const { position, action } = request;
  const actionMeta = position.action;
  if (!actionMeta) {
    throw new Error("This position does not support card actions yet");
  }
  if (action === "withdraw" && !actionMeta.withdrawable) {
    throw new Error("This position does not support withdrawals");
  }
  if (action === "claimRewards" && !actionMeta.claimable) {
    throw new Error("This position currently has no claimable rewards");
  }

  let tx: Transaction;
  if (position.protocol === "scallop") {
    tx = await buildScallopPositionTransaction(request);
  } else if (position.protocol === "bluefin") {
    tx = await buildBluefinPositionTransaction(request);
  } else {
    throw new Error(`${position.protocolName} position does not support card actions yet`);
  }

  tx.setSenderIfNotSet(request.address);
  tx.setGasBudgetIfNotSet(180_000_000);

  const summary =
    action === "withdraw"
      ? `${position.protocolName} withdraw ${request.percent}% ${position.asset}`
      : `${position.protocolName} claim rewards`;

  return { tx, summary };
}
