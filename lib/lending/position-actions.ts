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
  /** 取款百分比（1-100），action 为 withdraw 时必填。 */
  percent?: number;
};

/** 把仓位卡片上格式化过的数量（可能带千分位逗号）换算成基础单位。 */
function parsePositionAmountToBaseUnits(formatted: string, decimals: number): bigint {
  const cleaned = formatted.replace(/,/g, "").trim();
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    throw new Error(`无法解析仓位数量：${formatted}`);
  }
  const [whole, fraction = ""] = cleaned.split(".");
  const padded = fraction.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(whole || "0") * BigInt(10) ** BigInt(decimals) + BigInt(padded || "0");
}

function getPositionAmountBaseUnits(position: UserLendingPosition, decimals: number): bigint {
  const baseAmount = position.action?.baseAmount;
  if (baseAmount !== undefined) {
    if (!/^\d+$/.test(baseAmount)) {
      throw new Error("仓位原始数量格式无效");
    }
    return BigInt(baseAmount);
  }
  return parsePositionAmountToBaseUnits(position.amount, decimals);
}

function requirePercent(request: PositionActionRequest): number {
  const percent = request.percent ?? 0;
  if (!Number.isFinite(percent) || percent < 1 || percent > 100) {
    throw new Error("取款百分比需在 1-100 之间");
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
    throw new Error("未找到该 Scallop obligation，无法验证所有权");
  }
  if (obligation.locked) {
    throw new Error("该 Scallop obligation 处于质押锁定状态，请先在 Scallop 官网解除质押后再操作");
  }
  return obligation.keyId;
}

async function buildScallopPositionTransaction(
  request: PositionActionRequest,
): Promise<Transaction> {
  const { address, position, action } = request;
  const meta = position.action?.scallop;
  if (!meta) {
    throw new Error("缺少 Scallop 仓位元数据");
  }
  const client = await createScallopClient();

  if (meta.kind === "lending") {
    if (action === "claimRewards") {
      return (await client.claim(meta.sCoinName ?? `s${meta.coinName}`, false, undefined, address)) as Transaction;
    }

    // 取款：金额以 market coin（sCoin）基础单位计，按百分比对持有总量取整。
    const percent = requirePercent(request);
    const staked = Math.max(0, Math.floor(meta.stakedMarketAmount ?? 0));
    const unstaked = Math.max(0, Math.floor(meta.unstakedMarketAmount ?? 0));
    const total = staked + unstaked;
    if (total <= 0) {
      throw new Error("当前仓位没有可取款的份额");
    }
    const need = percent === 100 ? total : Math.floor((total * percent) / 100);
    if (need <= 0) {
      throw new Error("取款比例换算后的金额为 0，请提高比例");
    }
    const unstakedUse = Math.min(need, unstaked);
    const stakedUse = need - unstakedUse;

    const txBlock = client.builder.createTxBlock();
    txBlock.setSender(address);
    if (stakedUse > 0) {
      const marketCoin = await txBlock.unstakeQuick(stakedUse, meta.sCoinName ?? `s${meta.coinName}`, undefined, false);
      if (!marketCoin) {
        throw new Error("Scallop spool 中没有足够的质押份额可解押");
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

  // collateral / debt：都挂在 obligation 上，keyId 自动解析。
  const obligationId = meta.obligationId;
  if (!obligationId) {
    throw new Error("缺少 Scallop obligation ID");
  }
  const obligationKeyId = await resolveScallopObligationKeyId(client, address, obligationId);

  if (action === "claimRewards") {
    return (await client.claimBorrowIncentive(obligationId, obligationKeyId, false, address)) as Transaction;
  }

  if (meta.kind === "debt") {
    throw new Error("借款仓位不支持取款，请使用还款");
  }

  const percent = requirePercent(request);
  const decimals = position.action?.decimals ?? 6;
  const totalBase = getPositionAmountBaseUnits(position, decimals);
  const amountBase =
    percent === 100 ? totalBase : (totalBase * BigInt(percent)) / BigInt(100);
  const amountNumber = Number(amountBase);
  if (!Number.isSafeInteger(amountNumber) || amountNumber <= 0) {
    throw new Error("取款金额无效或超过安全整数范围");
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
    throw new Error("缺少 Bluefin 仓位元数据");
  }

  const { AlphalendClient: BluefinLendClient, getUserPositionCapId } = await import("@alphafi/alphalend-sdk");
  const client = new BluefinLendClient("mainnet");
  const positionCapId = await getUserPositionCapId(client.blockchain, address);
  if (!positionCapId) {
    throw new Error("未找到钱包中的 Bluefin Position Cap，无法操作该仓位");
  }

  if (action === "claimRewards") {
    const tx = await client.claimRewards({
      address,
      positionCapId,
      // 领到钱包（不复投）。
      claimAndDepositAll: false,
      claimAndDepositAlpha: false,
    });
    if (!tx) {
      throw new Error("Bluefin Lend 未返回交易，可能没有可领取的激励");
    }
    return tx;
  }

  const percent = requirePercent(request);
  const decimals = position.action?.decimals ?? 6;
  const totalBase = getPositionAmountBaseUnits(position, decimals);
  // 100% 时使用 SDK 约定的 MAX_U64 哨兵值取出全部，避免利息累计造成的尾差。
  const amount = percent === 100 ? MAX_U64 : (totalBase * BigInt(percent)) / BigInt(100);
  if (amount <= BigInt(0)) {
    throw new Error("取款比例换算后的金额为 0，请提高比例");
  }

  // 取款的风控检查需要该仓位涉及的所有资产价格都是新鲜的，否则 oracle 检查会 abort。
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
    // 拿不到完整仓位时退回只更新本资产价格
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
    throw new Error("Bluefin Lend 未返回取款交易");
  }
  return tx;
}

export async function buildPositionActionTransaction(
  request: PositionActionRequest,
): Promise<BuildLendingTransactionResult> {
  const { position, action } = request;
  const actionMeta = position.action;
  if (!actionMeta) {
    throw new Error("该仓位暂不支持卡片操作");
  }
  if (action === "withdraw" && !actionMeta.withdrawable) {
    throw new Error("该仓位不支持取款");
  }
  if (action === "claimRewards" && !actionMeta.claimable) {
    throw new Error("该仓位当前没有可领取的激励");
  }

  let tx: Transaction;
  if (position.protocol === "scallop") {
    tx = await buildScallopPositionTransaction(request);
  } else if (position.protocol === "bluefin") {
    tx = await buildBluefinPositionTransaction(request);
  } else {
    throw new Error(`${position.protocolName} 仓位暂不支持卡片操作`);
  }

  tx.setSenderIfNotSet(request.address);
  tx.setGasBudgetIfNotSet(180_000_000);

  const summary =
    action === "withdraw"
      ? `${position.protocolName} 取款 ${request.percent}% ${position.asset}`
      : `${position.protocolName} 领取激励`;

  return { tx, summary };
}
