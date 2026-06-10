import type { LendingAction, LendingAsset, LendingAssetSymbol, ProtocolCapability } from "./types";

export const SUI_COIN_TYPE = "0x2::sui::SUI";
export const NATIVE_USDC_COIN_TYPE =
  "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";

export const LENDING_ASSETS: Record<LendingAssetSymbol, LendingAsset> = {
  SUI: {
    symbol: "SUI",
    coinType: SUI_COIN_TYPE,
    decimals: 9,
    scallopCoinName: "sui",
  },
  USDC: {
    symbol: "USDC",
    coinType: NATIVE_USDC_COIN_TYPE,
    decimals: 6,
    scallopCoinName: "usdc",
  },
};

export const LENDING_ACTION_LABELS: Record<LendingAction, string> = {
  deposit: "存入抵押物",
  withdraw: "取款",
  borrow: "借款",
  repay: "还款",
  claimRewards: "领取激励",
};

export const PROTOCOL_CAPABILITIES: ProtocolCapability[] = [
  {
    id: "bluefin",
    name: "Bluefin Lend",
    sdkPackage: "Bluefin Lend market SDK source",
    state: "ready",
    actions: ["deposit", "borrow", "repay", "claimRewards"],
    description: "通过 Bluefin Lend 市场源构造 supply / borrow / repay / claimRewards 交易。",
    requiredFields: {
      borrow: ["Bluefin Position Cap ID"],
      repay: ["Bluefin Position Cap ID"],
      claimRewards: ["Bluefin Position Cap ID"],
    },
  },
  {
    id: "scallop",
    name: "Scallop",
    sdkPackage: "@scallop-io/sui-scallop-sdk",
    state: "ready",
    actions: ["deposit", "borrow", "repay", "claimRewards"],
    description: "通过 Scallop SDK 构造 supply / borrow / repay / claimBorrowIncentive 交易。",
    requiredFields: {
      borrow: ["Scallop Obligation ID", "Scallop Obligation Key ID"],
      repay: ["Scallop Obligation ID", "Scallop Obligation Key ID"],
      claimRewards: ["Scallop Obligation ID", "Scallop Obligation Key ID"],
    },
  },
  {
    id: "navi",
    name: "NAVI Protocol",
    sdkPackage: "NAVI open-api + 原生 moveCall",
    state: "ready",
    actions: ["deposit", "withdraw"],
    description:
      "官方 SDK 与 @mysten/sui v2 不兼容，改为从 NAVI open-api 拉取链上配置并以原生 moveCall 构造 supply / withdraw 交易。",
    requiredFields: {},
  },
  {
    id: "suilend",
    name: "Suilend",
    sdkPackage: "@suilend/sdk",
    state: "ready",
    actions: ["deposit"],
    description: "通过 Suilend SDK 构造 deposit 交易；若钱包尚无 obligation，会在同笔交易中自动创建。",
    requiredFields: {},
  },
];

export function getAsset(symbol: LendingAssetSymbol) {
  return LENDING_ASSETS[symbol];
}

export function getProtocolCapability(id: string) {
  return PROTOCOL_CAPABILITIES.find((protocol) => protocol.id === id);
}
