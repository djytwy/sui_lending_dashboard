export type ProtocolId = "navi" | "scallop" | "bluefin" | "suilend";

export type DataQuality = "live" | "partial" | "unavailable";

export type YieldRateBreakdown = {
  label: string;
  value: number | null;
  kind: "base" | "reward" | "staking" | "borrow";
};

export type YieldOpportunity = {
  id: string;
  protocol: ProtocolId;
  protocolName: string;
  product: string;
  asset: string;
  apr: number | null;
  apy: number | null;
  tvlUsd: number | null;
  baseApy: number | null;
  rewardApy: number | null;
  borrowApr: number | null;
  utilization: number | null;
  exposure: string;
  ilRisk: string;
  source: string;
  poolId: string | null;
  url: string | null;
  status: DataQuality;
  note: string;
  rateBreakdown: YieldRateBreakdown[];
};

export type YieldApiResponse = {
  generatedAt: string;
  refreshIntervalMs: number;
  chain: "Sui";
  asset: "USDC" | "USDSUI" | "USDT" | "Stablecoins";
  opportunities: YieldOpportunity[];
  sources: {
    scallopSdk: DataQuality;
    naviOpenApi: DataQuality;
    bluefinLend: DataQuality;
    suilendSdk: DataQuality;
  };
  warnings: string[];
};

export type PositionSide = "supply" | "borrow";

export type LendingPositionReward = {
  label: string;
  amount: string;
  coinType?: string;
};

/** Metadata required by position-card actions, assembled server-side and consumed by the client transaction builder. */
export type PositionActionMeta = {
  withdrawable: boolean;
  claimable: boolean;
  decimals: number;
  /** Raw position amount in base units for transaction math; UI amount can safely be formatted to 2 decimals. */
  baseAmount?: string;
  scallop?: {
    kind: "lending" | "collateral" | "debt";
    coinName: string;
    sCoinName?: string;
    /** Market coin (sCoin) amount in base units, used to calculate withdrawals. */
    stakedMarketAmount?: number;
    unstakedMarketAmount?: number;
    obligationId?: string;
  };
  bluefin?: {
    marketId: string;
    coinType: string;
  };
};

export type UserLendingPosition = {
  id: string;
  protocol: ProtocolId;
  protocolName: string;
  product: string;
  asset: string;
  side: PositionSide;
  amount: string;
  valueUsd: number | null;
  apr: number | null;
  rewards: LendingPositionReward[];
  positionId: string | null;
  url: string | null;
  source: string;
  status: DataQuality;
  note: string;
  action?: PositionActionMeta;
};

export type PositionsApiResponse = {
  generatedAt: string;
  address: string;
  positions: UserLendingPosition[];
  sources: Record<ProtocolId, DataQuality>;
  warnings: string[];
};

export const PROTOCOL_NAMES: Record<ProtocolId, string> = {
  navi: "NAVI Protocol",
  scallop: "Scallop",
  bluefin: "Bluefin Lend",
  suilend: "Suilend",
};
