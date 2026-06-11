import { Transaction } from "@mysten/sui/transactions";
import type { TransactionObjectArgument } from "@mysten/sui/transactions";
import type { ClaimRewardsReward } from "@suilend/sdk/client";
import type { Side as SuilendSideValue } from "@suilend/sdk/lib/types";
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
    throw new Error("Invalid amount format");
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
    throw new Error("Enter an amount greater than 0");
  }
  return amount;
}

function requireField(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Missing ${label}`);
  }
  return trimmed;
}
function requireScallopCoinName(asset: ReturnType<typeof getAsset>) {
  if (!asset.scallopCoinName) {
    throw new Error(`Scallop support for ${asset.symbol} is not configured in the installed SDK. Select USDC or use another protocol for this asset.`);
  }
  return asset.scallopCoinName;
}

async function buildScallopTransaction({
  input,
}: AdapterContext): Promise<BuildLendingTransactionResult> {
  const { ScallopClient } = await import("@scallop-io/sui-scallop-sdk");
  const asset = getAsset(input.asset);
  const scallopCoinName = requireScallopCoinName(asset);
  const amount = Number(requireAmount(input));

  if (!Number.isSafeInteger(amount)) {
    throw new Error("The Scallop SDK shortcut method uses number, and the current amount exceeds the safe integer range");
  }

  const client = new ScallopClient({
    addressId: "695fcdc084f790c04eb068dc",
    networkType: "mainnet",
  });
  await client.init();

  let tx: Transaction;
  if (input.action === "deposit") {
    tx = await client.supply(scallopCoinName, amount, false, input.address);
  } else if (input.action === "borrow") {
    const obligationId = requireField(input.scallopObligationId, "Scallop Obligation ID");
    const obligationKeyId = requireField(input.scallopObligationKeyId, "Scallop Obligation Key ID");
    tx = await client.borrow(scallopCoinName, amount, false, obligationId, obligationKeyId, input.address);
  } else if (input.action === "repay") {
    const obligationId = requireField(input.scallopObligationId, "Scallop Obligation ID");
    const obligationKeyId = requireField(input.scallopObligationKeyId, "Scallop Obligation Key ID");
    tx = await client.repay(scallopCoinName, amount, false, obligationId, obligationKeyId, input.address);
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
    throw new Error(`Bluefin Lend could not find a ${input.asset} market`);
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
    throw new Error("Bluefin Lend did not return a transaction. There may be no executable position or reward");
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
    throw new Error(`NAVI open-api ${label} request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

async function getNaviContext(coinType: string): Promise<{ config: NaviConfig; pool: NaviPoolInfo; poolObjectId: string }> {
  const { normalizeStructTag } = await import("@mysten/sui/utils");
  // The sdk parameter is required; without it, the API returns old package addresses and on-chain version checks abort(1400).
  const [configPayload, poolsPayload] = await Promise.all([
    fetchNaviJson<{ data?: NaviConfig }>("/config?env=prod&market=main&sdk=1.4.6", "config"),
    fetchNaviJson<{ data?: NaviPoolInfo[] }>("/pools?env=prod&market=main&sdk=1.4.6", "pools"),
  ]);

  const config = configPayload.data;
  if (!config?.package || !config.storage || !config.incentiveV2 || !config.incentiveV3 || !config.priceOracle) {
    throw new Error("NAVI open-api config is missing on-chain object addresses");
  }

  const pool = (poolsPayload.data ?? []).find(
    (item) => item.suiCoinType && normalizeStructTag(item.suiCoinType) === normalizeStructTag(coinType),
  );
  const poolObjectId = pool?.contract?.pool;
  if (!pool || !poolObjectId) {
    throw new Error(`NAVI could not find the pool for ${coinType}`);
  }

  return { config, pool, poolObjectId };
}

/** Build an exact-amount stablecoin from the user wallet by merging available coins, then splitting the requested amount. */
async function prepareExactCoin(
  tx: Transaction,
  input: LendingFormInput,
  amount: bigint,
): Promise<TransactionObjectArgument> {
  const asset = getAsset(input.asset);

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
    throw new Error(`${asset.symbol} balance is insufficient: need ${input.amount}, wallet only has ${collected} base units`);
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
    throw new Error("The NAVI adapter currently only supports deposit and withdraw");
  }

  const asset = getAsset(input.asset);
  const amount = requireAmount(input);
  const { config, pool, poolObjectId } = await getNaviContext(asset.coinType);

  const tx = new Transaction();

  if (input.action === "deposit") {
    const coin = await prepareExactCoin(tx, input, amount);
    // Equivalent to @naviprotocol/lending depositCoinPTB (incentive_v3::entry_deposit).
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
  } else {
    // Equivalent to withdrawCoinPTB: withdraw a Balance, convert it to a Coin, then transfer it to the user.
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

type SuilendSideModule = { Side: { DEPOSIT: SuilendSideValue; BORROW: SuilendSideValue } };

function collectSuilendClaimRewards(client: unknown, obligation: unknown, sideModule: SuilendSideModule): ClaimRewardsReward[] {
  const typedClient = client as {
    lendingMarket: {
      reserves: {
        depositsPoolRewardManager?: { poolRewards?: ({ coinType?: { name?: string } } | null)[] };
        borrowsPoolRewardManager?: { poolRewards?: ({ coinType?: { name?: string } } | null)[] };
      }[];
    };
  };
  const typedObligation = obligation as {
    deposits?: { reserveArrayIndex: string | bigint; userRewardManagerIndex: string | number | bigint }[];
    borrows?: { reserveArrayIndex: string | bigint; userRewardManagerIndex: string | number | bigint }[];
    userRewardManagers?: { rewards?: ({ earnedRewards?: { value?: string | number | bigint } } | null)[] }[];
  };

  const rewards: ClaimRewardsReward[] = [];

  const collectForSide = (
    records: { reserveArrayIndex: string | bigint; userRewardManagerIndex: string | number | bigint }[] | undefined,
    side: SuilendSideValue,
    rewardManagerKey: "depositsPoolRewardManager" | "borrowsPoolRewardManager",
  ) => {
    for (const record of records ?? []) {
      const reserveArrayIndex = BigInt(record.reserveArrayIndex);
      const userRewardManagerIndex = Number(record.userRewardManagerIndex);
      const userRewardManager = typedObligation.userRewardManagers?.[userRewardManagerIndex];
      const reserve = typedClient.lendingMarket.reserves[Number(reserveArrayIndex)];
      const poolRewards = reserve?.[rewardManagerKey]?.poolRewards ?? [];

      for (const [rewardIndex, userReward] of (userRewardManager?.rewards ?? []).entries()) {
        const earnedRewards = BigInt(userReward?.earnedRewards?.value ?? 0);
        if (earnedRewards <= BigInt(0)) continue;
        const rewardCoinType = poolRewards[rewardIndex]?.coinType?.name;
        if (!rewardCoinType) continue;
        rewards.push({
          reserveArrayIndex,
          rewardIndex: BigInt(rewardIndex),
          rewardCoinType,
          side,
        });
      }
    }
  };

  collectForSide(typedObligation.deposits, sideModule.Side.DEPOSIT, "depositsPoolRewardManager");
  collectForSide(typedObligation.borrows, sideModule.Side.BORROW, "borrowsPoolRewardManager");

  return rewards;
}

async function buildSuilendTransaction({
  input,
}: AdapterContext): Promise<BuildLendingTransactionResult> {
  if (input.action !== "deposit" && input.action !== "withdraw" && input.action !== "claimRewards") {
    throw new Error("The Suilend adapter currently only supports deposit, withdraw, and claimRewards");
  }

  const [{ SuilendClient, LENDING_MARKET_ID, LENDING_MARKET_TYPE }, { SuiGrpcClient }, sideModule] = await Promise.all([
    import("@suilend/sdk/client"),
    import("@mysten/sui/grpc"),
    import("@suilend/sdk/lib/types"),
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

  if (input.action !== "claimRewards") {
    const reserveIndex = client.findReserveArrayIndex(asset.coinType);
    if (reserveIndex < BigInt(0)) {
      throw new Error("Suilend could not find a " + input.asset + " reserve");
    }
  }

  const tx = new Transaction();
  if (input.action === "deposit") {
    if (obligationOwnerCaps.length > 0) {
      await client.depositIntoObligation(input.address, asset.coinType, amount.toString(), tx, obligationOwnerCaps[0].id);
    } else {
      // First deposit: create an obligation and transfer the owner cap to the user in the same transaction.
      const obligationOwnerCap = client.createObligation(tx);
      await client.depositIntoObligation(input.address, asset.coinType, amount.toString(), tx, obligationOwnerCap);
      tx.transferObjects([obligationOwnerCap], tx.pure.address(input.address));
    }
  } else {
    const obligationOwnerCap = obligationOwnerCaps[0];
    if (!obligationOwnerCap) {
      throw new Error("No Suilend obligation owner cap was found in this wallet");
    }

    if (input.action === "withdraw") {
      await client.withdrawAndSendToUser(
        input.address,
        obligationOwnerCap.id,
        obligationOwnerCap.obligationId,
        asset.coinType,
        amount.toString(),
        tx,
      );
    } else {
      const obligation = await client.getObligation(obligationOwnerCap.obligationId);
      const rewards = collectSuilendClaimRewards(client, obligation, sideModule as SuilendSideModule);
      if (!rewards.length) {
        throw new Error("No Suilend rewards are currently claimable for this wallet");
      }
      client.claimRewardsAndSendToUser(input.address, obligationOwnerCap.id, rewards, tx);
    }
  }

  tx.setSenderIfNotSet(input.address);
  tx.setGasBudgetIfNotSet(180_000_000);

  return {
    tx,
    summary: `Suilend ${LENDING_ACTION_LABELS[input.action]} ${input.action === "claimRewards" ? "" : `${input.amount} ${input.asset}`}`,
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
