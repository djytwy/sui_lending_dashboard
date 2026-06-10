/**
 * 验证脚本：不需要钱包，构造 NAVI 存款/取款 与 Suilend 存款交易后做 dry-run。
 * 用法：node scripts/dry-run-deposits.mjs <sender_address>
 * sender 需为一个主网上持有 USDC 的地址（仅 dry-run，不会发交易）。
 */
import { Transaction } from "@mysten/sui/transactions";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { normalizeStructTag } from "@mysten/sui/utils";
import { SuilendClient, LENDING_MARKET_ID, LENDING_MARKET_TYPE } from "@suilend/sdk/client";

const SENDER = process.argv[2];
if (!SENDER) {
  console.error("用法: node scripts/dry-run-deposits.mjs <sender_address>");
  process.exit(1);
}

const USDC = "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";
const AMOUNT = 1_000_000n; // 1 USDC
const NAVI_API = "https://open-api.naviprotocol.io/api/navi";

const client = new SuiJsonRpcClient({ network: "mainnet", url: getJsonRpcFullnodeUrl("mainnet") });

async function dryRun(label, tx) {
  try {
    tx.setSenderIfNotSet(SENDER);
    tx.setGasBudgetIfNotSet(180_000_000);
    const bytes = await tx.build({ client });
    const result = await client.dryRunTransactionBlock({ transactionBlock: bytes });
    const status = result.effects?.status;
    console.log(`[${label}] status=${status?.status}${status?.error ? ` error=${status.error}` : ""}`);
  } catch (error) {
    console.log(`[${label}] FAILED: ${error.message}`);
  }
}

async function prepareUsdcCoin(tx) {
  const coins = [];
  let collected = 0n;
  let cursor;
  do {
    const page = await client.getCoins({ owner: SENDER, coinType: USDC, cursor });
    for (const coin of page.data) {
      coins.push(coin);
      collected += BigInt(coin.balance);
      if (collected >= AMOUNT) break;
    }
    cursor = page.hasNextPage ? page.nextCursor : null;
  } while (collected < AMOUNT && cursor);
  if (collected < AMOUNT) throw new Error(`sender USDC 余额不足 (${collected})`);
  const primary = tx.object(coins[0].coinObjectId);
  if (coins.length > 1) tx.mergeCoins(primary, coins.slice(1).map((c) => tx.object(c.coinObjectId)));
  const [coin] = tx.splitCoins(primary, [AMOUNT]);
  return coin;
}

async function naviContext() {
  const [configRes, poolsRes] = await Promise.all([
    fetch(`${NAVI_API}/config?env=prod&market=main&sdk=1.4.6`).then((r) => r.json()),
    fetch(`${NAVI_API}/pools?env=prod&market=main&sdk=1.4.6`).then((r) => r.json()),
  ]);
  const config = configRes.data;
  const pool = (poolsRes.data ?? []).find(
    (p) => p.suiCoinType && normalizeStructTag(p.suiCoinType) === normalizeStructTag(USDC),
  );
  if (!config?.package || !pool?.contract?.pool) throw new Error("NAVI open-api 响应缺字段");
  console.log(`[navi-config] package=${config.package.slice(0, 12)}... version=${config.version} poolId=${pool.id}`);
  return { config, pool };
}

// --- NAVI deposit ---
async function naviDeposit() {
  const { config, pool } = await naviContext();
  const tx = new Transaction();
  const coin = await prepareUsdcCoin(tx);
  tx.moveCall({
    target: `${config.package}::incentive_v3::entry_deposit`,
    arguments: [
      tx.object("0x06"),
      tx.object(config.storage),
      tx.object(pool.contract.pool),
      tx.pure.u8(pool.id),
      coin,
      tx.pure.u64(AMOUNT),
      tx.object(config.incentiveV2),
      tx.object(config.incentiveV3),
    ],
    typeArguments: [pool.suiCoinType],
  });
  await dryRun("navi-deposit", tx);
}

// --- NAVI withdraw ---
async function naviWithdraw() {
  const { config, pool } = await naviContext();
  const isV2 = config.version === 2;
  const tx = new Transaction();
  const [balance] = tx.moveCall({
    target: `${config.package}::incentive_v3::${isV2 ? "withdraw_v2" : "withdraw"}`,
    arguments: [
      tx.object("0x06"),
      tx.object(config.priceOracle),
      tx.object(config.storage),
      tx.object(pool.contract.pool),
      tx.pure.u8(pool.id),
      tx.pure.u64(AMOUNT),
      tx.object(config.incentiveV2),
      tx.object(config.incentiveV3),
      ...(isV2 ? [tx.object("0x05")] : []),
    ],
    typeArguments: [pool.suiCoinType],
  });
  const [coin] = tx.moveCall({
    target: "0x2::coin::from_balance",
    arguments: [balance],
    typeArguments: [pool.suiCoinType],
  });
  tx.transferObjects([coin], tx.pure.address(SENDER));
  await dryRun("navi-withdraw", tx);
}

// --- Suilend deposit ---
async function suilendDeposit() {
  const grpcClient = new SuiGrpcClient({ network: "mainnet", baseUrl: "https://fullnode.mainnet.sui.io:443" });
  const suilend = await SuilendClient.initialize(LENDING_MARKET_ID, LENDING_MARKET_TYPE, grpcClient);
  const caps = await SuilendClient.getObligationOwnerCaps(SENDER, suilend.lendingMarket.$typeArgs, grpcClient);
  console.log(`[suilend] obligationOwnerCaps=${caps.length}`);
  const tx = new Transaction();
  if (caps.length > 0) {
    await suilend.depositIntoObligation(SENDER, USDC, AMOUNT.toString(), tx, caps[0].id);
  } else {
    const cap = suilend.createObligation(tx);
    await suilend.depositIntoObligation(SENDER, USDC, AMOUNT.toString(), tx, cap);
    tx.transferObjects([cap], tx.pure.address(SENDER));
  }
  await dryRun("suilend-deposit", tx);
}

for (const job of [naviDeposit, naviWithdraw, suilendDeposit]) {
  try {
    await job();
  } catch (error) {
    console.log(`[${job.name}] SETUP FAILED: ${error.message}`);
  }
}
