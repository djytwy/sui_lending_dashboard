# Lending Aggregator Move Package

This package is a Sui Move core for a lending aggregator across NAVI, Scallop,
Suilend, and Bucket Protocol.

## What It Implements

- `AdminCap`: unique admin capability minted to the publisher in `init`.
- `Config`: shared protocol config with the admin address, pause flag, and a
  default 10% performance fee (`1000` bps).
- `Vault<P, T>`: shared vault for one protocol marker and one asset type. User
  funds and any future protocol receipt objects must stay inside
  aggregator-owned objects.
- `Position<P, T>`: user-owned accounting object. It stores owner, principal,
  and shares, but never stores underlying protocol receipt objects.
- `RevenueVault<T>`: shared revenue object for one token type. Create one for
  each deposited asset or incentive token the protocol may collect.
- `RateBook`: append-only rate snapshots that a trusted backend/admin can update
  from NAVI, Scallop, Suilend, or Bucket APIs so the frontend can show protocol
  rates to users.

Deposits mint user `Position` objects without charging any fee. Withdrawals
charge the 10% performance fee only on profit:

```text
profit = max(gross_withdraw_amount - principal, 0)
fee = profit * performance_fee_bps / 10000
user_receives = gross_withdraw_amount - fee
```

Protocol incentive rewards are treated as pure profit, so `split_reward` sends
90% to the user and 10% into the corresponding `RevenueVault<T>`.

## Protocol Adapters

The four adapter modules currently route through the escrow fallback in
`core.move`. They compile and are deployable, but they intentionally do not
hard-code third-party mainnet calls.

Before production mainnet launch, replace each adapter body with the audited
function calls from the corresponding protocol package:

- `navi_adapter.move`
- `scallop_adapter.move`
- `suilend_adapter.move`
- `bucket_adapter.move`

For each adapter, pin and audit:

- mainnet package ID
- required shared object IDs
- deposit, withdraw, and reward claim function signatures
- receipt/cToken/position object types
- oracle, clock, version, market, and slippage requirements
- behavior when a market is paused or deprecated

Do not transfer external protocol receipt objects to users. Receipts must remain
under aggregator-owned objects so users can only withdraw through this package
and cannot bypass the withdrawal performance fee.

## Build

```bash
sui move build
```

## Test

```bash
sui move test
```
