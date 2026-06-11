/**
 * Validation script: use the production code path directly (lib/yield-positions.ts + lib/lending/position-actions.ts),
 * automatically find recent addresses that interacted with Scallop / Bluefin Lend and use their real USDC positions
 * to dry-run withdraw (50%/100%) and claim transactions. No wallet is required and no transaction is submitted.
 *
 * Usage: node --experimental-strip-types --import ./scripts/register-loader.mjs scripts/dry-run-position-actions.mjs [address]
 */
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { getPositionsDashboardData } from "../lib/yield-positions.ts";
import { buildPositionActionTransaction } from "../lib/lending/position-actions.ts";

const SCALLOP_MARKET_OBJECT = "0xed80ed898df1e0b7a14b78c92527b47ef88591d5722ded16050d7e101687bb20";
const ALPHALEND_PROTOCOL_OBJECT = "0x01d9cf05d65fa3a9bb7163095139120e3c4e414dfbab153a49779a7d14010b93";

const client = new SuiJsonRpcClient({ network: "mainnet", url: getJsonRpcFullnodeUrl("mainnet") });

async function rpc(method, params) {
  const res = await fetch(getJsonRpcFullnodeUrl("mainnet"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return (await res.json()).result;
}

async function recentSenders(inputObject, limit = 25) {
  const txs = await rpc("suix_queryTransactionBlocks", [
    { filter: { InputObject: inputObject }, options: { showInput: true } },
    null,
    limit,
    true,
  ]);
  const senders = [];
  for (const tx of txs?.data ?? []) {
    const sender = tx.transaction?.data?.sender;
    if (sender && !senders.includes(sender)) senders.push(sender);
  }
  return senders;
}

async function dryRun(label, tx, sender) {
  try {
    tx.setSenderIfNotSet(sender);
    const bytes = await tx.build({ client });
    const result = await client.dryRunTransactionBlock({ transactionBlock: bytes });
    const status = result.effects?.status;
    console.log(`[${label}] status=${status?.status}${status?.error ? ` error=${String(status.error).slice(0, 160)}` : ""}`);
  } catch (error) {
    console.log(`[${label}] BUILD FAILED: ${error.message.slice(0, 200)}`);
  }
}

async function testPositionsFor(address, protocol) {
  const payload = await getPositionsDashboardData(address);
  const positions = payload.positions.filter((p) => p.protocol === protocol && p.action);
  if (!positions.length) return false;

  console.log(`\n== ${protocol} address ${address.slice(0, 12)}... with ${positions.length} USDC positions`);
  for (const position of positions) {
    const tag = `${position.id}`;
    if (position.action.withdrawable) {
      for (const percent of [50, 100]) {
        try {
          const { tx } = await buildPositionActionTransaction({ address, position, action: "withdraw", percent });
          await dryRun(`${tag} withdraw ${percent}%`, tx, address);
        } catch (error) {
          console.log(`[${tag} withdraw ${percent}%] BUILD FAILED: ${error.message.slice(0, 200)}`);
        }
      }
    }
    if (position.action.claimable) {
      try {
        const { tx } = await buildPositionActionTransaction({ address, position, action: "claimRewards" });
        await dryRun(`${tag} claim`, tx, address);
      } catch (error) {
        console.log(`[${tag} claim] BUILD FAILED: ${error.message.slice(0, 200)}`);
      }
    } else {
      console.log(`[${tag}] No claimable rewards, skipping claim`);
    }
  }
  return true;
}

const manualAddress = process.argv[2];
if (manualAddress) {
  await testPositionsFor(manualAddress, "scallop");
  await testPositionsFor(manualAddress, "bluefin");
} else {
  for (const [protocol, object] of [
    ["scallop", SCALLOP_MARKET_OBJECT],
    ["bluefin", ALPHALEND_PROTOCOL_OBJECT],
  ]) {
    const senders = await recentSenders(object);
    console.log(`${protocol}: found ${senders.length} candidate addresses`);
    let done = 0;
    for (const sender of senders) {
      if (done >= 1) break;
      try {
        if (await testPositionsFor(sender, protocol)) done++;
      } catch (error) {
        console.log(`  ${sender.slice(0, 12)}... query failed: ${error.message.slice(0, 120)}`);
      }
    }
    if (!done) console.log(`${protocol}: no candidate address with USDC positions was found`);
  }
}
