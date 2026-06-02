/// NAVI adapter boundary.
///
/// These entry functions currently route through the core escrow fallback. For
/// production mainnet use, replace the deposit/withdraw bodies with calls to
/// NAVI's audited package IDs and keep all NAVI receipt objects inside the
/// aggregator-owned `Vault<protocols::Navi, T>` boundary.
module lending_aggregator::navi_adapter;

use lending_aggregator::core::{Self, Config, RevenueVault, Vault};
use lending_aggregator::protocols;
use sui::coin::Coin;
use sui::tx_context::{Self, TxContext};
use sui::transfer;

entry fun deposit<T>(
    config: &Config,
    vault: &mut Vault<protocols::Navi, T>,
    coin: Coin<T>,
    ctx: &mut TxContext,
) {
    let position = core::deposit_internal(config, vault, coin, ctx);
    transfer::public_transfer(position, tx_context::sender(ctx));
}

entry fun withdraw<T>(
    config: &Config,
    vault: &mut Vault<protocols::Navi, T>,
    revenue_vault: &mut RevenueVault<T>,
    position: core::Position<protocols::Navi, T>,
    ctx: &mut TxContext,
) {
    let user_coin = core::withdraw_escrow(config, vault, revenue_vault, position, ctx);
    transfer::public_transfer(user_coin, tx_context::sender(ctx));
}
