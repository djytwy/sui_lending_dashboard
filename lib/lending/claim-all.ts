import { Transaction } from "@mysten/sui/transactions";
import type { UserLendingPosition } from "@/lib/yield-types";
import { lendingAdapters } from "./adapters";
import { buildPositionActionTransaction } from "./position-actions";
import type { BuildLendingTransactionResult, LendingFormInput } from "./types";

export type ClaimAllRewardStep = BuildLendingTransactionResult & {
  protocolName: string;
};

export async function buildClaimAllRewardTransactions({
  address,
  positions,
}: {
  address: string;
  positions: UserLendingPosition[];
}): Promise<ClaimAllRewardStep[]> {
  const steps: ClaimAllRewardStep[] = [];
  const claimablePositions = uniqueClaimablePositions(positions);

  for (const position of claimablePositions) {
    const result = await buildPositionActionTransaction({
      address,
      action: "claimRewards",
      position,
    });
    steps.push({
      ...result,
      protocolName: position.protocolName,
    });
  }

  const suilendStep = await buildSuilendClaimRewards(address);
  if (suilendStep) {
    steps.push(suilendStep);
  }

  const naviStep = await buildNaviClaimRewards(address);
  if (naviStep) {
    steps.push(naviStep);
  }

  if (!steps.length) {
    throw new Error("No claimable rewards were found across the connected protocols");
  }

  return steps;
}

function uniqueClaimablePositions(positions: UserLendingPosition[]) {
  const seen = new Set<string>();
  return positions.filter((position) => {
    if (!position.action?.claimable) return false;
    const key = claimKey(position);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function claimKey(position: UserLendingPosition) {
  if (position.protocol === "bluefin") return "bluefin";
  if (position.protocol === "scallop") {
    const meta = position.action?.scallop;
    if (meta?.kind === "lending") return `scallop-lending-${meta.coinName}`;
    if (meta?.obligationId) return `scallop-obligation-${meta.obligationId}`;
  }
  return `${position.protocol}-${position.positionId ?? position.id}`;
}

async function buildSuilendClaimRewards(address: string): Promise<ClaimAllRewardStep | null> {
  const adapter = lendingAdapters.suilend;
  if (!adapter) return null;

  try {
    const result = await adapter.buildTransaction({
      input: claimInput(address, "suilend"),
    });
    return {
      ...result,
      protocolName: "Suilend",
    };
  } catch (reason) {
    if (isNoRewardsError(reason)) return null;
    throw reason;
  }
}

async function buildNaviClaimRewards(address: string): Promise<ClaimAllRewardStep | null> {
  const { claimLendingRewardsPTB, getUserAvailableLendingRewards } = await import("@naviprotocol/lending");
  const rewards = await getUserAvailableLendingRewards(address, {
    env: "prod",
  });
  if (!rewards.length) return null;

  const tx = new Transaction();
  await claimLendingRewardsPTB(tx, rewards, {
    customCoinReceive: {
      transfer: address,
      type: "transfer",
    },
    env: "prod",
  });
  tx.setSenderIfNotSet(address);
  tx.setGasBudgetIfNotSet(180_000_000);

  return {
    protocolName: "NAVI Protocol",
    summary: "NAVI Protocol claim rewards",
    tx,
  };
}

function claimInput(address: string, protocol: LendingFormInput["protocol"]): LendingFormInput {
  return {
    action: "claimRewards",
    address,
    amount: "",
    asset: "USDC",
    bluefinPositionCapId: "",
    protocol,
    scallopObligationId: "",
    scallopObligationKeyId: "",
  };
}

function isNoRewardsError(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason);
  return /no .*rewards?|no claimable rewards?|currently has no claimable/i.test(message);
}
