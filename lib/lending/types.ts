import type { Transaction } from "@mysten/sui/transactions";

export type LendingProtocolId = "navi" | "scallop" | "bluefin" | "suilend";

export type LendingAction = "deposit" | "withdraw" | "borrow" | "repay" | "claimRewards";

export type LendingAssetSymbol = "USDC" | "USDSUI" | "USDT";

export type LendingAsset = {
  symbol: LendingAssetSymbol;
  coinType: string;
  decimals: number;
  scallopCoinName?: string;
};

export type ProtocolRuntimeState = "ready" | "needsConfig" | "sdkBlocked";

export type ProtocolCapability = {
  id: LendingProtocolId;
  name: string;
  sdkPackage: string;
  state: ProtocolRuntimeState;
  actions: LendingAction[];
  description: string;
  requiredFields: Partial<Record<LendingAction, string[]>>;
  warning?: string;
};

export type LendingFormInput = {
  protocol: LendingProtocolId;
  action: LendingAction;
  asset: LendingAssetSymbol;
  amount: string;
  address: string;
  scallopObligationId: string;
  scallopObligationKeyId: string;
  bluefinPositionCapId: string;
};

export type RewardRow = {
  protocol: LendingProtocolId;
  label: string;
  amount: string;
  coinType?: string;
};

export type AdapterContext = {
  input: LendingFormInput;
};

export type BuildLendingTransactionResult = {
  tx: Transaction;
  summary: string;
};

export type ProtocolAdapter = {
  buildTransaction: (context: AdapterContext) => Promise<BuildLendingTransactionResult>;
  queryRewards?: (address: string) => Promise<RewardRow[]>;
};
