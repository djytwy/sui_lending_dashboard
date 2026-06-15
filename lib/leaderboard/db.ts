import { neon } from "@neondatabase/serverless";

const databaseUrl =
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL ??
  process.env.POSTGRES_PRISMA_URL ??
  process.env.DATABASE_URL_UNPOOLED ??
  "";

if (!databaseUrl) {
  throw new Error("Missing DATABASE_URL or POSTGRES_URL for Neon leaderboard storage");
}

export const sql = neon(databaseUrl);

let schemaReady: Promise<void> | null = null;

export function ensureLeaderboardSchema() {
  schemaReady ??= createLeaderboardSchema();
  return schemaReady;
}

async function createLeaderboardSchema() {
  await sql`
    create table if not exists leaderboard_wallets (
      address text primary key,
      first_seen_at timestamptz not null default now(),
      last_seen_at timestamptz not null default now(),
      source text not null default 'dashboard',
      last_deposit_protocol text,
      last_deposit_asset text,
      last_deposit_amount numeric,
      last_deposit_digest text
    )
  `;

  await sql`
    create table if not exists leaderboard_snapshots (
      id bigserial primary key,
      snapshot_hour timestamptz not null unique,
      started_at timestamptz not null default now(),
      completed_at timestamptz,
      status text not null default 'running',
      wallet_count integer not null default 0,
      total_points numeric not null default 0,
      warnings text[] not null default '{}',
      error text
    )
  `;

  await sql`
    create table if not exists leaderboard_snapshot_positions (
      snapshot_id bigint not null references leaderboard_snapshots(id) on delete cascade,
      address text not null references leaderboard_wallets(address) on delete cascade,
      scallop_points numeric not null default 0,
      bluefin_points numeric not null default 0,
      navi_points numeric not null default 0,
      suilend_points numeric not null default 0,
      total_points numeric not null default 0,
      positions jsonb not null default '[]'::jsonb,
      warnings text[] not null default '{}',
      created_at timestamptz not null default now(),
      primary key (snapshot_id, address)
    )
  `;

  await sql`
    create table if not exists leaderboard_user_points (
      address text primary key references leaderboard_wallets(address) on delete cascade,
      total_points numeric not null default 0,
      last_snapshot_id bigint references leaderboard_snapshots(id) on delete set null,
      last_snapshot_points numeric not null default 0,
      last_snapshot_at timestamptz,
      snapshot_count integer not null default 0,
      updated_at timestamptz not null default now()
    )
  `;

  await sql`
    create index if not exists leaderboard_user_points_rank_idx
      on leaderboard_user_points (total_points desc, last_snapshot_points desc, updated_at asc)
  `;

  await sql`
    create index if not exists leaderboard_snapshot_positions_address_idx
      on leaderboard_snapshot_positions (address, created_at desc)
  `;
}
