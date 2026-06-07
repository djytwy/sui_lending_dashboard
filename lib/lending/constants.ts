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
  borrow: "借款",
  repay: "还款",
  claimRewards: "领取激励",
};

export const PROTOCOL_CAPABILITIES: ProtocolCapability[] = [
  {
    id: "alphalend",
    name: "AlphaLend",
    sdkPackage: "@alphafi/alphalend-sdk",
    state: "ready",
    actions: ["deposit", "borrow", "repay", "claimRewards"],
    description: "通过 AlphaLend SDK 构造 supply / borrow / repay / claimRewards 交易。",
    requiredFields: {
      borrow: ["AlphaLend Position Cap ID"],
      repay: ["AlphaLend Position Cap ID"],
      claimRewards: ["AlphaLend Position Cap ID"],
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
    id: "suilend",
    name: "Suilend",
    sdkPackage: "@suilend/sdk",
    state: "sdkBlocked",
    actions: ["deposit", "borrow", "repay", "claimRewards"],
    description: "SDK 已安装，但当前 npm 包的 ESM 子路径解析在本项目中阻塞运行时导入。",
    requiredFields: {
      deposit: ["Suilend Obligation Owner Cap ID"],
      borrow: ["Suilend Obligation ID", "Suilend Obligation Owner Cap ID"],
      repay: ["Suilend Obligation ID"],
      claimRewards: ["Suilend Obligation Owner Cap ID"],
    },
    warning:
      "@suilend/sdk@2.0.7 在 Node/Next ESM 解析下存在 extensionless 子路径导入问题；不要在主 bundle 直接导入根入口。",
  },
  {
    id: "navi",
    name: "NAVI Protocol",
    sdkPackage: "@naviprotocol/lending",
    state: "sdkBlocked",
    actions: ["deposit", "borrow", "repay", "claimRewards"],
    description: "SDK 已安装，但当前包导入了 @mysten/sui/client 中 v2 不再导出的 SuiClient/getFullnodeUrl。",
    requiredFields: {},
    warning:
      "@naviprotocol/lending@1.4.6 的发布产物与当前 @mysten/sui@2.17.0 运行时不兼容，需要协议包升级或单独兼容层。",
  },
];

export function getAsset(symbol: LendingAssetSymbol) {
  return LENDING_ASSETS[symbol];
}

export function getProtocolCapability(id: string) {
  return PROTOCOL_CAPABILITIES.find((protocol) => protocol.id === id);
}
