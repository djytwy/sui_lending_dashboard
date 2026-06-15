import type { LendingAssetSymbol, LendingProtocolId } from "@/lib/lending/types";

export type LeaderboardProtocolPoints = {
  scallop: number;
  bluefin: number;
  navi: number;
  suilend: number;
};

export type RegisterLeaderboardWalletInput = {
  address: string;
  source?: string;
  protocol?: LendingProtocolId;
  asset?: LendingAssetSymbol;
  amount?: string;
  digest?: string;
};

export type LeaderboardEntry = {
  rank: number;
  address: string;
  totalPoints: number;
  lastSnapshotPoints: number;
  lastSnapshotAt: string | null;
  snapshotCount: number;
  protocolPoints: LeaderboardProtocolPoints;
};

export type LeaderboardResponse = {
  generatedAt: string;
  entries: LeaderboardEntry[];
  latestSnapshot: {
    id: number;
    snapshotHour: string;
    completedAt: string | null;
    status: string;
    walletCount: number;
    totalPoints: number;
    warnings: string[];
    error: string | null;
  } | null;
};

export type SnapshotRunResult = {
  snapshotId: number;
  snapshotHour: string;
  walletCount: number;
  totalPoints: number;
  warnings: string[];
};
