import { getPositionsDashboardData } from "@/lib/yield-positions";
import type { ProtocolId, UserLendingPosition } from "@/lib/yield-types";
import { ensureLeaderboardSchema, sql } from "./db";
import type {
  LeaderboardEntry,
  LeaderboardProtocolPoints,
  LeaderboardResponse,
  RegisterLeaderboardWalletInput,
  SnapshotRunResult,
} from "./types";

const SUI_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{64}$/;
const PROTOCOLS: ProtocolId[] = ["scallop", "bluefin", "navi", "suilend"];

type WalletRow = {
  address: string;
};

type SnapshotRow = {
  id: string;
  snapshot_hour: string;
  completed_at: string | null;
  status: string;
  wallet_count: number;
  total_points: string;
  warnings: string[] | null;
  error: string | null;
};

type LeaderboardRow = {
  address: string;
  total_points: string;
  last_snapshot_points: string;
  last_snapshot_at: string | null;
  snapshot_count: number;
  scallop_points: string | null;
  bluefin_points: string | null;
  navi_points: string | null;
  suilend_points: string | null;
};

export async function registerLeaderboardWallet(input: RegisterLeaderboardWalletInput) {
  await ensureLeaderboardSchema();
  const address = normalizeSuiAddress(input.address);

  await sql`
    insert into leaderboard_wallets (
      address,
      source,
      last_deposit_protocol,
      last_deposit_asset,
      last_deposit_amount,
      last_deposit_digest
    )
    values (
      ${address},
      ${input.source ?? "dashboard"},
      ${input.protocol ?? null},
      ${input.asset ?? null},
      ${input.amount ? numericOrNull(input.amount) : null},
      ${input.digest ?? null}
    )
    on conflict (address) do update set
      last_seen_at = now(),
      source = excluded.source,
      last_deposit_protocol = coalesce(excluded.last_deposit_protocol, leaderboard_wallets.last_deposit_protocol),
      last_deposit_asset = coalesce(excluded.last_deposit_asset, leaderboard_wallets.last_deposit_asset),
      last_deposit_amount = coalesce(excluded.last_deposit_amount, leaderboard_wallets.last_deposit_amount),
      last_deposit_digest = coalesce(excluded.last_deposit_digest, leaderboard_wallets.last_deposit_digest)
  `;

  await sql`
    insert into leaderboard_user_points (address)
    values (${address})
    on conflict (address) do nothing
  `;

  return { address };
}

export async function runLeaderboardSnapshot(snapshotDate = new Date()): Promise<SnapshotRunResult> {
  await ensureLeaderboardSchema();
  const snapshotHour = floorToHour(snapshotDate);
  const snapshotHourIso = snapshotHour.toISOString();

  const snapshot = await createRunningSnapshot(snapshotHourIso);
  const snapshotId = Number(snapshot.id);

  try {
    const wallets = (await sql`
      select address
      from leaderboard_wallets
      order by first_seen_at asc
    `) as WalletRow[];

    let totalPoints = 0;
    const warnings: string[] = [];

    for (const wallet of wallets) {
      const result = await scoreWallet(wallet.address);
      totalPoints += result.totalPoints;
      warnings.push(...result.warnings.map((warning) => `${shortAddress(wallet.address)}: ${warning}`));

      await sql`
        insert into leaderboard_snapshot_positions (
          snapshot_id,
          address,
          scallop_points,
          bluefin_points,
          navi_points,
          suilend_points,
          total_points,
          positions,
          warnings
        )
        values (
          ${snapshotId},
          ${wallet.address},
          ${result.protocolPoints.scallop},
          ${result.protocolPoints.bluefin},
          ${result.protocolPoints.navi},
          ${result.protocolPoints.suilend},
          ${result.totalPoints},
          ${JSON.stringify(result.positions)}::jsonb,
          ${result.warnings}
        )
        on conflict (snapshot_id, address) do update set
          scallop_points = excluded.scallop_points,
          bluefin_points = excluded.bluefin_points,
          navi_points = excluded.navi_points,
          suilend_points = excluded.suilend_points,
          total_points = excluded.total_points,
          positions = excluded.positions,
          warnings = excluded.warnings
      `;

      await sql`
        insert into leaderboard_user_points (
          address,
          total_points,
          last_snapshot_id,
          last_snapshot_points,
          last_snapshot_at,
          snapshot_count,
          updated_at
        )
        values (
          ${wallet.address},
          ${result.totalPoints},
          ${snapshotId},
          ${result.totalPoints},
          ${snapshotHourIso},
          1,
          now()
        )
        on conflict (address) do update set
          total_points = leaderboard_user_points.total_points + excluded.last_snapshot_points,
          last_snapshot_id = excluded.last_snapshot_id,
          last_snapshot_points = excluded.last_snapshot_points,
          last_snapshot_at = excluded.last_snapshot_at,
          snapshot_count = leaderboard_user_points.snapshot_count + 1,
          updated_at = now()
        where leaderboard_user_points.last_snapshot_id is distinct from excluded.last_snapshot_id
      `;
    }

    await sql`
      update leaderboard_snapshots
      set
        completed_at = now(),
        status = 'completed',
        wallet_count = ${wallets.length},
        total_points = ${totalPoints},
        warnings = ${warnings}
      where id = ${snapshotId}
    `;

    return {
      snapshotId,
      snapshotHour: snapshotHourIso,
      walletCount: wallets.length,
      totalPoints,
      warnings,
    };
  } catch (error) {
    await sql`
      update leaderboard_snapshots
      set
        completed_at = now(),
        status = 'failed',
        error = ${errorMessage(error)}
      where id = ${snapshotId}
    `;
    throw error;
  }
}

export async function getLeaderboard(limit = 100): Promise<LeaderboardResponse> {
  await ensureLeaderboardSchema();
  const safeLimit = Math.min(500, Math.max(1, Math.floor(limit)));

  const [latestSnapshot] = (await sql`
    select id, snapshot_hour, completed_at, status, wallet_count, total_points, warnings, error
    from leaderboard_snapshots
    order by snapshot_hour desc
    limit 1
  `) as SnapshotRow[];

  const rows = (await sql`
    select
      up.address,
      up.total_points,
      up.last_snapshot_points,
      up.last_snapshot_at,
      up.snapshot_count,
      sp.scallop_points,
      sp.bluefin_points,
      sp.navi_points,
      sp.suilend_points
    from leaderboard_user_points up
    left join leaderboard_snapshot_positions sp
      on sp.snapshot_id = up.last_snapshot_id
      and sp.address = up.address
    order by up.total_points desc, up.last_snapshot_points desc, up.updated_at asc
    limit ${safeLimit}
  `) as LeaderboardRow[];

  return {
    generatedAt: new Date().toISOString(),
    latestSnapshot: latestSnapshot
      ? {
          id: Number(latestSnapshot.id),
          snapshotHour: new Date(latestSnapshot.snapshot_hour).toISOString(),
          completedAt: latestSnapshot.completed_at ? new Date(latestSnapshot.completed_at).toISOString() : null,
          status: latestSnapshot.status,
          walletCount: latestSnapshot.wallet_count,
          totalPoints: numericToNumber(latestSnapshot.total_points),
          warnings: latestSnapshot.warnings ?? [],
          error: latestSnapshot.error,
        }
      : null,
    entries: rows.map((row, index): LeaderboardEntry => ({
      rank: index + 1,
      address: row.address,
      totalPoints: numericToNumber(row.total_points),
      lastSnapshotPoints: numericToNumber(row.last_snapshot_points),
      lastSnapshotAt: row.last_snapshot_at ? new Date(row.last_snapshot_at).toISOString() : null,
      snapshotCount: row.snapshot_count,
      protocolPoints: {
        scallop: numericToNumber(row.scallop_points),
        bluefin: numericToNumber(row.bluefin_points),
        navi: numericToNumber(row.navi_points),
        suilend: numericToNumber(row.suilend_points),
      },
    })),
  };
}

async function createRunningSnapshot(snapshotHourIso: string) {
  const [snapshot] = (await sql`
    insert into leaderboard_snapshots (snapshot_hour, status)
    values (${snapshotHourIso}, 'running')
    on conflict (snapshot_hour) do update set
      started_at = now(),
      completed_at = null,
      status = 'running',
      wallet_count = 0,
      total_points = 0,
      warnings = '{}',
      error = null
    returning id, snapshot_hour, completed_at, status, wallet_count, total_points, warnings, error
  `) as SnapshotRow[];

  if (!snapshot) {
    throw new Error("Failed to create leaderboard snapshot");
  }
  return snapshot;
}

async function scoreWallet(address: string) {
  const data = await getPositionsDashboardData(address);
  const protocolPoints = zeroProtocolPoints();
  const supplyPositions = data.positions.filter((position) => position.side === "supply" && position.asset === "USDC");

  for (const position of supplyPositions) {
    protocolPoints[position.protocol] += position.valueUsd ?? parseFormattedNumber(position.amount);
  }

  return {
    protocolPoints,
    totalPoints: PROTOCOLS.reduce((sum, protocol) => sum + protocolPoints[protocol], 0),
    positions: supplyPositions.map(slimPosition),
    warnings: data.warnings,
  };
}

function slimPosition(position: UserLendingPosition) {
  return {
    id: position.id,
    protocol: position.protocol,
    protocolName: position.protocolName,
    product: position.product,
    asset: position.asset,
    side: position.side,
    amount: position.amount,
    valueUsd: position.valueUsd,
    source: position.source,
    status: position.status,
    positionId: position.positionId,
  };
}

function zeroProtocolPoints(): LeaderboardProtocolPoints {
  return {
    scallop: 0,
    bluefin: 0,
    navi: 0,
    suilend: 0,
  };
}

function floorToHour(value: Date) {
  const date = new Date(value);
  date.setUTCMinutes(0, 0, 0);
  return date;
}

function normalizeSuiAddress(address: string) {
  const normalized = address.trim().toLowerCase();
  if (!SUI_ADDRESS_PATTERN.test(normalized)) {
    throw new Error("Invalid Sui address");
  }
  return normalized;
}

function numericOrNull(value: string) {
  const normalized = value.replace(/,/g, "").trim();
  if (!normalized) return null;
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return normalized;
}

function numericToNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined) return 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseFormattedNumber(value: string) {
  const numeric = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(numeric) ? numeric : 0;
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
