export type ProtocolId = "navi" | "scallop" | "bluefin";

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
  asset: "USDC";
  opportunities: YieldOpportunity[];
  sources: {
    scallopSdk: DataQuality;
    naviOpenApi: DataQuality;
    bluefinLend: DataQuality;
  };
  warnings: string[];
};

export type PositionSide = "supply" | "borrow";

export type LendingPositionReward = {
  label: string;
  amount: string;
  coinType?: string;
};

/** 仓位卡片操作所需的元数据，由后端组装、前端的交易构造层直接消费。 */
export type PositionActionMeta = {
  withdrawable: boolean;
  claimable: boolean;
  decimals: number;
  /** 原始仓位基础单位数量，用于交易计算；UI 的 amount 可以安全格式化为 2 位小数。 */
  baseAmount?: string;
  scallop?: {
    kind: "lending" | "collateral" | "debt";
    coinName: string;
    sCoinName?: string;
    /** market coin（sCoin）基础单位数量，取款金额按它换算。 */
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
};
