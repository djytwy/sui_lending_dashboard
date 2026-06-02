/// Mainnet adapter checklist.
///
/// This module intentionally contains no callable code. It documents what must
/// be pinned before replacing the escrow fallback in each protocol adapter:
///
/// 1. Exact mainnet package ID for NAVI, Scallop, Suilend, or Bucket.
/// 2. Exact shared object IDs required by the protocol.
/// 3. Deposit, withdraw, and reward-claim function signatures.
/// 4. Receipt/cToken/position object types and whether they are transferable.
/// 5. Oracle, clock, version, or market objects required by the protocol.
/// 6. Slippage/min-out and paused-market behavior.
///
/// Never transfer protocol receipt objects to users. Receipts must stay under an
/// aggregator-owned object so users can only withdraw through this package.
module lending_aggregator::adapter_notes;
