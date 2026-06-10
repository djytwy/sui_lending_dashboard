import { Transaction } from "@mysten/sui/transactions";
import type { TransactionObjectArgument } from "@mysten/sui/transactions";
import { LENDING_ACTION_LABELS, getAsset } from "./constants";
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

const NAVI_OPEN_API_BASE = "https://open-api.naviprotocol.io/api/navi";
const SUI_CLOCK_OBJECT = "0x06";
const SUI_SYSTEM_STATE_OBJECT = "0x05";

type NaviConfig = {
  package: string;
  storage: string;
  incentiveV2: string;
  incentiveV3: string;
  priceOracle: string;
  version?: number;
};

type NaviPoolInfo = {
  id: number;
  suiCoinType: string;
  status?: string;
  token?: { symbol?: string };
  contract?: { pool?: string };
};

async function fetchNaviJson<T>(path: string, label: string): Promise<T> {
  const response = await fetch(`${NAVI_OPEN_API_BASE}${path}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    throw new Error(`NAVI open-api ${label} 请求失败：${response.status}`);
  }
  return (await response.json()) as T;
}

async function getNaviContext(coinType: string): Promise<{ config: NaviConfig; pool: NaviPoolInfo; poolObjectId: string }> {
  const { normalizeStructTag } = await import("@mysten/sui/utils");
  // sdk 参数必带：不带时 API 返回升级前的旧包地址，链上 version 检查会 abort(1400)。
  const [configPayload, poolsPayload] = await Promise.all([
    fetchNaviJson<{ data?: NaviConfig }>("/config?env=prod&market=main&sdk=1.4.6", "config"),
    fetchNaviJson<{ data?: NaviPoolInfo[] }>("/pools?env=prod&market=main&sdk=1.4.6", "pools"),
  ]);

  const config = configPayload.data;
  if (!config?.package || !config.storage || !config.incentiveV2 || !config.incentiveV3 || !config.priceOracle) {
    throw new Error("NAVI open-api 配置缺少链上对象地址");
  }

  const pool = (poolsPayload.data ?? []).find(
    (item) => item.suiCoinType && normalizeStructTag(item.suiCoinType) === normalizeStructTag(coinType),
  );
  const poolObjectId = pool?.contract?.pool;
  if (!pool || !poolObjectId) {
    throw new Error(`NAVI 未找到 ${coinType} 对应的资金池`);
  }

  return { config, pool, poolObjectId };
}

/** 从用户钱包凑出指定金额的 coin（SUI 直接拆 gas，其余资产合并后再拆分）。 */
async function prepareExactCoin(
  tx: Transaction,
  input: LendingFormInput,
  amount: bigint,
): Promise<TransactionObjectArgument> {
  const asset = getAsset(input.asset);
  if (asset.symbol === "SUI") {
    const [coin] = tx.splitCoins(tx.gas, [amount]);
    return coin;
  }

  const { SuiJsonRpcClient, getJsonRpcFullnodeUrl } = await import("@mysten/sui/jsonRpc");
  const client = new SuiJsonRpcClient({ network: "mainnet", url: getJsonRpcFullnodeUrl("mainnet") });

  const coins: { coinObjectId: string; balance: string }[] = [];
  let collected = BigInt(0);
  let cursor: string | null | undefined;
  do {
    const page = await client.getCoins({ owner: input.address, coinType: asset.coinType, cursor });
    for (const coin of page.data) {
      coins.push(coin);
      collected += BigInt(coin.balance);
      if (collected >= amount) break;
    }
    cursor = page.hasNextPage ? page.nextCursor : null;
  } while (collected < amount && cursor);

  if (collected < amount) {
    throw new Error(`${asset.symbol} 余额不足：需要 ${input.amount}，钱包仅有 ${collected} 基础单位`);
  }

  const primary = tx.object(coins[0].coinObjectId);
  if (coins.length > 1) {
    tx.mergeCoins(
      primary,
      coins.slice(1).map((coin) => tx.object(coin.coinObjectId)),
    );
  }
  const [coin] = tx.splitCoins(primary, [amount]);
  return coin;
}

async function buildNaviTransaction({
  input,
}: AdapterContext): Promise<BuildLendingTransactionResult> {
  if (input.action !== "deposit" && input.action !== "withdraw") {
    throw new Error("NAVI 适配器当前仅支持存款与取款");
  }

  const asset = getAsset(input.asset);
  const amount = requireAmount(input);
  const { config, pool, poolObjectId } = await getNaviContext(asset.coinType);

  const tx = new Transaction();

  if (input.action === "deposit") {
    const coin = await prepareExactCoin(tx, input, amount);
    // 等价于 @naviprotocol/lending 的 depositCoinPTB（incentive_v3::entry_deposit）。
    tx.moveCall({
      target: `${config.package}::incentive_v3::entry_deposit`,
      arguments: [
        tx.object(SUI_CLOCK_OBJECT),
        tx.object(config.storage),
        tx.object(poolObjectId),
        tx.pure.u8(pool.id),
        coin,
        tx.pure.u64(amount),
        tx.object(config.incentiveV2),
        tx.object(config.incentiveV3),
      ],
      typeArguments: [pool.suiCoinType],
    });
    if (config.version === 2 && asset.symbol === "SUI") {
      tx.moveCall({
        target: `${config.package}::pool::refresh_stake`,
        arguments: [tx.object(poolObjectId), tx.object(SUI_SYSTEM_STATE_OBJECT)],
      });
    }
  } else {
    // 等价于 withdrawCoinPTB：取出 Balance 后转换为 Coin 并转给用户。
    const isV2 = config.version === 2;
    const [balance] = tx.moveCall({
      target: `${config.package}::incentive_v3::${isV2 ? "withdraw_v2" : "withdraw"}`,
      arguments: [
        tx.object(SUI_CLOCK_OBJECT),
        tx.object(config.priceOracle),
        tx.object(config.storage),
        tx.object(poolObjectId),
        tx.pure.u8(pool.id),
        tx.pure.u64(amount),
        tx.object(config.incentiveV2),
        tx.object(config.incentiveV3),
        ...(isV2 ? [tx.object(SUI_SYSTEM_STATE_OBJECT)] : []),
      ],
      typeArguments: [pool.suiCoinType],
    });
    const [coin] = tx.moveCall({
      target: "0x2::coin::from_balance",
      arguments: [balance],
      typeArguments: [pool.suiCoinType],
    });
    tx.transferObjects([coin], tx.pure.address(input.address));
  }

  tx.setSenderIfNotSet(input.address);
  tx.setGasBudgetIfNotSet(150_000_000);

  return {
    tx,
    summary: `NAVI ${LENDING_ACTION_LABELS[input.action]} ${input.amount} ${input.asset}`,
  };
}

async function buildSuilendTransaction({
  input,
}: AdapterContext): Promise<BuildLendingTransactionResult> {
  if (input.action !== "deposit") {
    throw new Error("Suilend 适配器当前仅支持存款");
  }

  const [{ SuilendClient, LENDING_MARKET_ID, LENDING_MARKET_TYPE }, { SuiGrpcClient }] = await Promise.all([
    import("@suilend/sdk/client"),
    import("@mysten/sui/grpc"),
  ]);

  const asset = getAsset(input.asset);
  const amount = requireAmount(input);

  const grpcClient = new SuiGrpcClient({
    network: "mainnet",
    baseUrl: "https://fullnode.mainnet.sui.io:443",
  });
  const client = await SuilendClient.initialize(LENDING_MARKET_ID, LENDING_MARKET_TYPE, grpcClient);
  const obligationOwnerCaps = await SuilendClient.getObligationOwnerCaps(
    input.address,
    client.lendingMarket.$typeArgs,
    grpcClient,
  );

  const tx = new Transaction();
  if (obligationOwnerCaps.length > 0) {
    await client.depositIntoObligation(input.address, asset.coinType, amount.toString(), tx, obligationOwnerCaps[0].id);
  } else {
    // 首次存款：同一笔交易里创建 obligation 并把凭证转给用户。
    const obligationOwnerCap = client.createObligation(tx);
    await client.depositIntoObligation(input.address, asset.coinType, amount.toString(), tx, obligationOwnerCap);
    tx.transferObjects([obligationOwnerCap], tx.pure.address(input.address));
  }

  tx.setSenderIfNotSet(input.address);
  tx.setGasBudgetIfNotSet(180_000_000);

  return {
    tx,
    summary: `Suilend ${LENDING_ACTION_LABELS[input.action]} ${input.amount} ${input.asset}`,
  };
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
  navi: {
    buildTransaction: buildNaviTransaction,
  },
  suilend: {
    buildTransaction: buildSuilendTransaction,
  },
};
