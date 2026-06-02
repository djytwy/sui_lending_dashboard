/// Bucket Protocol adapter boundary. See `adapter_notes.move` before replacing
/// the escrow fallback with real Bucket mainnet calls.
module lending_aggregator::bucket_adapter;

use lending_aggregator::core::{Self, Config, RevenueVault, Vault};
use lending_aggregator::protocols;
use sui::coin::Coin;
use sui::tx_context::{Self, TxContext};
use sui::transfer;

entry fun deposit<T>(
    config: &Config,
    vault: &mut Vault<protocols::Bucket, T>,
    coin: Coin<T>,
    ctx: &mut TxContext,
) {
    let position = core::deposit_internal(config, vault, coin, ctx);
    transfer::public_transfer(position, tx_context::sender(ctx));
}

entry fun withdraw<T>(
    config: &Config,
    vault: &mut Vault<protocols::Bucket, T>,
    revenue_vault: &mut RevenueVault<T>,
    position: core::Position<protocols::Bucket, T>,
    ctx: &mut TxContext,
) {
    let user_coin = core::withdraw_escrow(config, vault, revenue_vault, position, ctx);
    transfer::public_transfer(user_coin, tx_context::sender(ctx));
}
