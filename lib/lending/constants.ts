import type { LendingAction, LendingAsset, LendingAssetSymbol, LendingProtocolId, ProtocolCapability } from "./types";

export const NATIVE_USDC_COIN_TYPE =
  "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";
export const USDSUI_COIN_TYPE =
  "0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI";
export const USDT_COIN_TYPE =
  "0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT";

export const LENDING_ASSETS: Record<LendingAssetSymbol, LendingAsset> = {
  USDC: {
    symbol: "USDC",
    coinType: NATIVE_USDC_COIN_TYPE,
    decimals: 6,
    scallopCoinName: "usdc",
  },
  USDSUI: {
    symbol: "USDSUI",
    coinType: USDSUI_COIN_TYPE,
    decimals: 6,
  },
  USDT: {
    symbol: "USDT",
    coinType: USDT_COIN_TYPE,
    decimals: 6,
  },
};

export const STABLECOIN_ASSET_SYMBOLS = Object.keys(LENDING_ASSETS) as LendingAssetSymbol[];
export const STABLECOIN_ASSETS = STABLECOIN_ASSET_SYMBOLS.map((symbol) => LENDING_ASSETS[symbol]);

export const LENDING_ACTION_LABELS: Record<LendingAction, string> = {
  deposit: "Deposit",
  withdraw: "Withdraw",
  borrow: "Borrow",
  repay: "Repay",
  claimRewards: "Claim rewards",
};

export const PROTOCOL_CAPABILITIES: ProtocolCapability[] = [
  {
    id: "bluefin",
    name: "Bluefin Lend",
    sdkPackage: "Bluefin Lend market SDK source",
    state: "ready",
    actions: ["deposit", "borrow", "repay", "claimRewards"],
    description: "Build supply / borrow / repay / claimRewards transactions through the Bluefin Lend market source.",
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
    description: "Build supply / borrow / repay / claimBorrowIncentive transactions through the Scallop SDK.",
    requiredFields: {
      borrow: ["Scallop Obligation ID", "Scallop Obligation Key ID"],
      repay: ["Scallop Obligation ID", "Scallop Obligation Key ID"],
      claimRewards: ["Scallop Obligation ID", "Scallop Obligation Key ID"],
    },
    warning: "Scallop assets are resolved dynamically from the SDK pool list; unsupported coin types fail during transaction building.",
  },
  {
    id: "navi",
    name: "NAVI Protocol",
    sdkPackage: "NAVI open-api + native moveCall",
    state: "ready",
    actions: ["deposit", "withdraw"],
    description:
      "The official SDK is incompatible with @mysten/sui v2, so this adapter pulls on-chain config from the NAVI open-api and builds supply / withdraw transactions with native moveCall.",
    requiredFields: {},
  },
  {
    id: "suilend",
    name: "Suilend",
    sdkPackage: "@suilend/sdk",
    state: "ready",
    actions: ["deposit", "withdraw", "claimRewards"],
    description: "Build deposit, withdraw, and claim reward transactions through the Suilend SDK; if the wallet has no obligation yet, create one in the same transaction for deposits.",
    requiredFields: {},
  },
];

export function getAsset(symbol: LendingAssetSymbol) {
  return LENDING_ASSETS[symbol];
}

export function getProtocolCapability(id: string) {
  return PROTOCOL_CAPABILITIES.find((protocol) => protocol.id === id);
}

export function isLendingAssetSupported(protocol: LendingProtocolId, symbol: LendingAssetSymbol) {
  void protocol;
  void symbol;
  return true;
}

export function firstSupportedLendingAsset(protocol: LendingProtocolId) {
  return STABLECOIN_ASSET_SYMBOLS.find((symbol) => isLendingAssetSupported(protocol, symbol)) ?? STABLECOIN_ASSET_SYMBOLS[0];
}
