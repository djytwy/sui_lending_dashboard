import { Transaction } from "@mysten/sui/transactions";
import { LENDING_ACTION_LABELS, getAsset, getProtocolCapability } from "./constants";
import type {
  AdapterContext,
  BuildLendingTransactionResult,
  LendingFormInput,
  ProtocolAdapter,
  RewardRow,
} from "./types";

function parseAmountToBaseUnits(value: string, decimals: number): bigint {
  const trimmed = value.trim();
  if (!trimmed) return BigInt(0);
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("金额格式无效");
  }

  const [whole, fraction = ""] = trimmed.split(".");
  const padded = fraction.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(whole || "0") * BigInt(10) ** BigInt(decimals) + BigInt(padded || "0");
}

function requireAmount(input: LendingFormInput): bigint {
  if (input.action === "claimRewards") return BigInt(0);

  const asset = getAsset(input.asset);
  const amount = parseAmountToBaseUnits(input.amount, asset.decimals);
  if (amount <= BigInt(0)) {
    throw new Error("请输入大于 0 的金额");
  }
  return amount;
}

function requireField(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`缺少 ${label}`);
  }
  return trimmed;
}

function unsupportedAdapter(protocolId: string): ProtocolAdapter {
  return {
    buildTransaction: async () => {
      const capability = getProtocolCapability(protocolId);
      throw new Error(capability?.warning ?? `${protocolId} SDK 当前不可用`);
    },
  };
}

async function buildScallopTransaction({
  input,
}: AdapterContext): Promise<BuildLendingTransactionResult> {
  const { ScallopClient } = await import("@scallop-io/sui-scallop-sdk");
  const asset = getAsset(input.asset);
  const amount = Number(requireAmount(input));

  if (!Number.isSafeInteger(amount)) {
    throw new Error("Scallop SDK 的快捷方法使用 number，当前金额超过安全整数范围");
  }

  const client = new ScallopClient({
    addressId: "695fcdc084f790c04eb068dc",
    networkType: "mainnet",
  });
  await client.init();

  let tx: Transaction;
  if (input.action === "deposit") {
    tx = await client.supply(asset.scallopCoinName, amount, false, input.address);
  } else if (input.action === "borrow") {
    const obligationId = requireField(input.scallopObligationId, "Scallop Obligation ID");
    const obligationKeyId = requireField(input.scallopObligationKeyId, "Scallop Obligation Key ID");
    tx = await client.borrow(asset.scallopCoinName, amount, false, obligationId, obligationKeyId, input.address);
  } else if (input.action === "repay") {
    const obligationId = requireField(input.scallopObligationId, "Scallop Obligation ID");
    const obligationKeyId = requireField(input.scallopObligationKeyId, "Scallop Obligation Key ID");
    tx = await client.repay(asset.scallopCoinName, amount, false, obligationId, obligationKeyId, input.address);
  } else {
    const obligationId = requireField(input.scallopObligationId, "Scallop Obligation ID");
    const obligationKeyId = requireField(input.scallopObligationKeyId, "Scallop Obligation Key ID");
    tx = await client.claimBorrowIncentive(obligationId, obligationKeyId, false, input.address);
  }

  tx.setSenderIfNotSet(input.address);
  tx.setGasBudgetIfNotSet(150_000_000);

  return {
    tx,
    summary: `Scallop ${LENDING_ACTION_LABELS[input.action]} ${input.action === "claimRewards" ? "" : `${input.amount} ${input.asset}`}`,
  };
}

async function buildBluefinTransaction({
  input,
}: AdapterContext): Promise<BuildLendingTransactionResult> {
  const { AlphalendClient: BluefinLendClient } = await import("@alphafi/alphalend-sdk");
  const client = new BluefinLendClient("mainnet");
  const asset = getAsset(input.asset);
  const amount = requireAmount(input);

  const markets = await client.getAllMarkets({ useCache: true, cacheTTL: 60_000 });
  const market = markets?.find((item) => item.coinType === asset.coinType);
  const marketId = market?.marketId?.toString();
  if (!marketId) {
    throw new Error(`Bluefin Lend 未找到 ${input.asset} 市场`);
  }

  let tx: Transaction | undefined;
  if (input.action === "deposit") {
    tx = await client.supply({
      address: input.address,
      amount,
      coinType: asset.coinType,
      marketId,
      positionCapId: input.bluefinPositionCapId.trim() || undefined,
    });
  } else if (input.action === "borrow") {
    tx = await client.borrow({
      address: input.address,
      amount,
      coinType: asset.coinType,
      marketId,
      positionCapId: requireField(input.bluefinPositionCapId, "Bluefin Position Cap ID"),
      priceUpdateCoinTypes: [asset.coinType],
    });
  } else if (input.action === "repay") {
    tx = await client.repay({
      address: input.address,
      amount,
      coinType: asset.coinType,
      marketId,
      positionCapId: requireField(input.bluefinPositionCapId, "Bluefin Position Cap ID"),
    });
  } else {
    tx = await client.claimRewards({
      address: input.address,
      claimAndDepositAll: true,
      claimAndDepositAlpha: true,
      positionCapId: requireField(input.bluefinPositionCapId, "Bluefin Position Cap ID"),
    });
  }

  if (!tx) {
    throw new Error("Bluefin Lend 未返回交易，可能没有可执行的仓位或奖励");
  }

  tx.setSenderIfNotSet(input.address);
  tx.setGasBudgetIfNotSet(180_000_000);

  return {
    tx,
    summary: `Bluefin Lend ${LENDING_ACTION_LABELS[input.action]} ${input.action === "claimRewards" ? "" : `${input.amount} ${input.asset}`}`,
  };
}

async function queryBluefinRewards(address: string): Promise<RewardRow[]> {
  const { AlphalendClient: BluefinLendClient } = await import("@alphafi/alphalend-sdk");
  const client = new BluefinLendClient("mainnet");
  const portfolios = await client.getUserPortfolio(address);

  return (
    portfolios?.flatMap((portfolio) =>
      portfolio.rewardsToClaim.map((reward) => ({
        protocol: "bluefin" as const,
        label: "Bluefin Lend reward",
        amount: reward.rewardAmount.toString(),
        coinType: reward.coinType,
      })),
    ) ?? []
  );
}

async function queryScallopRewards(address: string): Promise<RewardRow[]> {
  const { ScallopClient } = await import("@scallop-io/sui-scallop-sdk");
  const client = new ScallopClient({
    addressId: "695fcdc084f790c04eb068dc",
    networkType: "mainnet",
  });
  await client.init();
  const obligations = await client.getObligations(address);

  return obligations.flatMap((obligation) => {
    const borrowIncentives =
      typeof obligation === "object" && obligation !== null && "borrowIncentives" in obligation
        ? (obligation.borrowIncentives as Record<string, { rewards?: Record<string, Record<string, unknown>> }>)
        : {};

    return Object.entries(borrowIncentives).flatMap(([coinName, incentive]) =>
      Object.entries(incentive.rewards ?? {}).map(([rewardName, reward]) => ({
        protocol: "scallop" as const,
        label: `${coinName} ${rewardName}`,
        amount: String(reward.claimedRewardAmount ?? reward.claimedRewardCoin ?? 0),
      })),
    );
  });
}

export const lendingAdapters: Record<string, ProtocolAdapter> = {
  bluefin: {
    buildTransaction: buildBluefinTransaction,
    queryRewards: queryBluefinRewards,
  },
  scallop: {
    buildTransaction: buildScallopTransaction,
    queryRewards: queryScallopRewards,
  },
  navi: unsupportedAdapter("navi"),
};
