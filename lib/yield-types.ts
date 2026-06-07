export type ProtocolId = "navi" | "scallop" | "alphafi" | "bluefin";

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
    alphaLendSdk: DataQuality;
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
  alphafi: "AlphaFi",
  bluefin: "Bluefin Lend",
};
