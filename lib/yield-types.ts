export type ProtocolId = "navi" | "scallop" | "alphafi" | "bluefin";

export type DataQuality = "live" | "partial" | "unavailable";

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
  utilization: number | null;
  exposure: string;
  ilRisk: string;
  source: string;
  poolId: string | null;
  url: string | null;
  status: DataQuality;
  note: string;
};

export type YieldApiResponse = {
  generatedAt: string;
  refreshIntervalMs: number;
  chain: "Sui";
  asset: "USDC";
  opportunities: YieldOpportunity[];
  sources: {
    defiLlama: DataQuality;
    suiGraphql: DataQuality;
  };
  warnings: string[];
};

export const PROTOCOL_NAMES: Record<ProtocolId, string> = {
  navi: "NAVI Protocol",
  scallop: "Scallop",
  alphafi: "AlphaFi",
  bluefin: "Bluefin",
};
