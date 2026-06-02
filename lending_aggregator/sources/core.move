/// Core accounting for a Sui lending aggregator.
///
/// The package keeps user funds and any future external-protocol receipt objects
/// under aggregator-owned shared objects. Users receive only Position objects,
/// so withdrawals must go through this package and the performance fee cannot be
/// bypassed by redeeming protocol receipts directly.
module lending_aggregator::core;

use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::event;
use sui::object::{Self, UID};
use sui::transfer;
use sui::tx_context::{Self, TxContext};
use std::vector;

const FEE_DENOMINATOR_BPS: u64 = 10_000;
const DEFAULT_PERFORMANCE_FEE_BPS: u64 = 1_000;

const ENotAdmin: u64 = 1;
const EPaused: u64 = 2;
const EZeroAmount: u64 = 3;
const ENotOwner: u64 = 4;
const EInsufficientLiquidity: u64 = 5;
const EInvalidFee: u64 = 6;
const EWithdrawTooSmallForFee: u64 = 7;

public struct AdminCap has key, store {
    id: UID,
}

public struct Config has key {
    id: UID,
    admin: address,
    performance_fee_bps: u64,
    paused: bool,
}

/// Revenue object for one coin type. Create one vault for each asset and reward
/// token the adapters may collect as protocol income.
public struct RevenueVault<phantom T> has key {
    id: UID,
    balance: Balance<T>,
}

/// Append-only rate snapshots for frontends. A trusted updater can write rates
/// from protocol APIs/oracles; the chain will not fetch APY by itself.
public struct RateBook has key {
    id: UID,
    snapshots: vector<RateSnapshot>,
}

public struct RateSnapshot has copy, drop, store {
    protocol: u8,
    asset: vector<u8>,
    supply_apy_bps: u64,
    reward_apy_bps: u64,
    updated_at_ms: u64,
}

/// Aggregator vault for a protocol/asset pair.
///
/// `P` is one of the marker types in `protocols.move`. In the escrow fallback
/// implementation below, `liquidity` holds user coins directly. Production
/// protocol adapters should move receipt/cToken/position objects into this same
/// shared object boundary, then call the accounting functions in this module.
public struct Vault<phantom P, phantom T> has key {
    id: UID,
    protocol: u8,
    deposits_paused: bool,
    withdrawals_paused: bool,
    total_principal: u64,
    total_shares: u64,
    liquidity: Balance<T>,
}

/// User-owned accounting position. The underlying asset and protocol receipts
/// are deliberately not stored here.
public struct Position<phantom P, phantom T> has key, store {
    id: UID,
    owner: address,
    principal: u64,
    shares: u64,
}

public struct DepositEvent has copy, drop {
    owner: address,
    protocol: u8,
    principal: u64,
    shares: u64,
}

public struct WithdrawEvent has copy, drop {
    owner: address,
    protocol: u8,
    principal: u64,
    gross_amount: u64,
    performance_fee: u64,
    user_amount: u64,
}

public struct RewardFeeEvent has copy, drop {
    owner: address,
    gross_amount: u64,
    protocol_fee: u64,
    user_amount: u64,
}

public struct RateSnapshotEvent has copy, drop {
    protocol: u8,
    asset: vector<u8>,
    supply_apy_bps: u64,
    reward_apy_bps: u64,
    updated_at_ms: u64,
}

fun init(ctx: &mut TxContext) {
    let admin = tx_context::sender(ctx);
    transfer::transfer(AdminCap { id: object::new(ctx) }, admin);
    transfer::share_object(Config {
        id: object::new(ctx),
        admin,
        performance_fee_bps: DEFAULT_PERFORMANCE_FEE_BPS,
        paused: false,
    });
}

public fun admin(config: &Config): address {
    config.admin
}

public fun performance_fee_bps(config: &Config): u64 {
    config.performance_fee_bps
}

public fun is_paused(config: &Config): bool {
    config.paused
}

public fun vault_total_principal<P, T>(vault: &Vault<P, T>): u64 {
    vault.total_principal
}

public fun vault_total_shares<P, T>(vault: &Vault<P, T>): u64 {
    vault.total_shares
}

public fun vault_liquidity<P, T>(vault: &Vault<P, T>): u64 {
    balance::value(&vault.liquidity)
}

public fun position_owner<P, T>(position: &Position<P, T>): address {
    position.owner
}

public fun position_principal<P, T>(position: &Position<P, T>): u64 {
    position.principal
}

public fun position_shares<P, T>(position: &Position<P, T>): u64 {
    position.shares
}

public fun revenue_balance<T>(vault: &RevenueVault<T>): u64 {
    balance::value(&vault.balance)
}

public fun rate_snapshot_count(book: &RateBook): u64 {
    vector::length(&book.snapshots)
}

public fun rate_snapshot_at(book: &RateBook, index: u64): RateSnapshot {
    *vector::borrow(&book.snapshots, index)
}

entry fun set_admin(config: &mut Config, _: &AdminCap, new_admin: address, ctx: &TxContext) {
    assert_admin(config, ctx);
    config.admin = new_admin;
}

entry fun set_paused(config: &mut Config, _: &AdminCap, paused: bool, ctx: &TxContext) {
    assert_admin(config, ctx);
    config.paused = paused;
}

entry fun set_performance_fee_bps(
    config: &mut Config,
    _: &AdminCap,
    performance_fee_bps: u64,
    ctx: &TxContext,
) {
    assert_admin(config, ctx);
    assert!(performance_fee_bps <= FEE_DENOMINATOR_BPS, EInvalidFee);
    config.performance_fee_bps = performance_fee_bps;
}

entry fun create_revenue_vault<T>(config: &Config, _: &AdminCap, ctx: &mut TxContext) {
    assert_admin(config, ctx);
    transfer::share_object(RevenueVault<T> {
        id: object::new(ctx),
        balance: balance::zero<T>(),
    });
}

entry fun create_vault<P, T>(
    config: &Config,
    _: &AdminCap,
    protocol: u8,
    ctx: &mut TxContext,
) {
    assert_admin(config, ctx);
    transfer::share_object(Vault<P, T> {
        id: object::new(ctx),
        protocol,
        deposits_paused: false,
        withdrawals_paused: false,
        total_principal: 0,
        total_shares: 0,
        liquidity: balance::zero<T>(),
    });
}

entry fun create_rate_book(config: &Config, _: &AdminCap, ctx: &mut TxContext) {
    assert_admin(config, ctx);
    transfer::share_object(RateBook {
        id: object::new(ctx),
        snapshots: vector[],
    });
}

entry fun add_rate_snapshot(
    config: &Config,
    _: &AdminCap,
    book: &mut RateBook,
    protocol: u8,
    asset: vector<u8>,
    supply_apy_bps: u64,
    reward_apy_bps: u64,
    updated_at_ms: u64,
    ctx: &TxContext,
) {
    assert_admin(config, ctx);
    let snapshot = RateSnapshot {
        protocol,
        asset,
        supply_apy_bps,
        reward_apy_bps,
        updated_at_ms,
    };
    vector::push_back(&mut book.snapshots, snapshot);
    event::emit(RateSnapshotEvent {
        protocol,
        asset,
        supply_apy_bps,
        reward_apy_bps,
        updated_at_ms,
    });
}

entry fun set_vault_paused<P, T>(
    config: &Config,
    _: &AdminCap,
    vault: &mut Vault<P, T>,
    deposits_paused: bool,
    withdrawals_paused: bool,
    ctx: &TxContext,
) {
    assert_admin(config, ctx);
    vault.deposits_paused = deposits_paused;
    vault.withdrawals_paused = withdrawals_paused;
}

/// Escrow fallback deposit. Production adapters may call this after they move
/// the user's coin into the external protocol and lock the external receipt in
/// an aggregator-owned object.
entry fun deposit<P, T>(
    config: &Config,
    vault: &mut Vault<P, T>,
    coin: Coin<T>,
    ctx: &mut TxContext,
) {
    let position = deposit_internal(config, vault, coin, ctx);
    transfer::public_transfer(position, tx_context::sender(ctx));
}

/// Escrow fallback withdrawal. Production adapters should redeem the external
/// protocol position first and then call `withdraw_with_redeemed_coin`.
entry fun withdraw<P, T>(
    config: &Config,
    vault: &mut Vault<P, T>,
    revenue_vault: &mut RevenueVault<T>,
    position: Position<P, T>,
    ctx: &mut TxContext,
) {
    let user_coin = withdraw_escrow(config, vault, revenue_vault, position, ctx);
    transfer::public_transfer(user_coin, tx_context::sender(ctx));
}

public fun withdraw_escrow<P, T>(
    config: &Config,
    vault: &mut Vault<P, T>,
    revenue_vault: &mut RevenueVault<T>,
    position: Position<P, T>,
    ctx: &mut TxContext,
): Coin<T> {
    assert!(!config.paused && !vault.withdrawals_paused, EPaused);
    assert!(position.owner == tx_context::sender(ctx), ENotOwner);

    let gross = position_redeem_amount(vault, &position);
    assert!(gross <= balance::value(&vault.liquidity), EInsufficientLiquidity);
    let redeemed_balance = balance::split(&mut vault.liquidity, gross);
    let redeemed_coin = coin::from_balance(redeemed_balance, ctx);
    close_position_with_redeemed_coin(config, vault, revenue_vault, position, redeemed_coin, ctx)
}

/// Public adapter hook for closing a position after an external protocol has
/// already been redeemed into `redeemed_coin`.
public fun withdraw_with_redeemed_coin<P, T>(
    config: &Config,
    vault: &mut Vault<P, T>,
    revenue_vault: &mut RevenueVault<T>,
    position: Position<P, T>,
    redeemed_coin: Coin<T>,
    ctx: &mut TxContext,
): Coin<T> {
    assert!(!config.paused && !vault.withdrawals_paused, EPaused);
    assert!(position.owner == tx_context::sender(ctx), ENotOwner);
    close_position_with_redeemed_coin(config, vault, revenue_vault, position, redeemed_coin, ctx)
}

/// Split protocol incentive rewards. Rewards are pure profit, so the protocol
/// fee is charged on the whole claimed amount.
entry fun split_reward<T>(
    config: &Config,
    revenue_vault: &mut RevenueVault<T>,
    reward: Coin<T>,
    recipient: address,
    ctx: &mut TxContext,
) {
    assert!(!config.paused, EPaused);
    let user_coin = split_reward_internal(config, revenue_vault, reward, tx_context::sender(ctx), ctx);
    transfer::public_transfer(user_coin, recipient);
}

public fun split_reward_for_adapter<T>(
    config: &Config,
    revenue_vault: &mut RevenueVault<T>,
    reward: Coin<T>,
    owner: address,
    ctx: &mut TxContext,
): Coin<T> {
    assert!(!config.paused, EPaused);
    split_reward_internal(config, revenue_vault, reward, owner, ctx)
}

entry fun withdraw_revenue<T>(
    config: &Config,
    _: &AdminCap,
    revenue_vault: &mut RevenueVault<T>,
    amount: u64,
    ctx: &mut TxContext,
) {
    assert_admin(config, ctx);
    assert!(amount > 0, EZeroAmount);
    let coin = coin::take(&mut revenue_vault.balance, amount, ctx);
    transfer::public_transfer(coin, tx_context::sender(ctx));
}

public fun deposit_internal<P, T>(
    config: &Config,
    vault: &mut Vault<P, T>,
    coin: Coin<T>,
    ctx: &mut TxContext,
): Position<P, T> {
    assert!(!config.paused && !vault.deposits_paused, EPaused);

    let amount = coin::value(&coin);
    assert!(amount > 0, EZeroAmount);

    let shares = mint_shares(vault, amount);
    vault.total_principal = vault.total_principal + amount;
    vault.total_shares = vault.total_shares + shares;
    balance::join(&mut vault.liquidity, coin::into_balance(coin));

    let owner = tx_context::sender(ctx);
    event::emit(DepositEvent {
        owner,
        protocol: vault.protocol,
        principal: amount,
        shares,
    });

    Position<P, T> {
        id: object::new(ctx),
        owner,
        principal: amount,
        shares,
    }
}

fun close_position_with_redeemed_coin<P, T>(
    config: &Config,
    vault: &mut Vault<P, T>,
    revenue_vault: &mut RevenueVault<T>,
    position: Position<P, T>,
    redeemed_coin: Coin<T>,
    ctx: &mut TxContext,
): Coin<T> {
    let Position { id, owner, principal, shares } = position;
    object::delete(id);

    let gross = coin::value(&redeemed_coin);
    let fee = performance_fee(config, principal, gross);
    let user_amount = gross - fee;

    vault.total_principal = vault.total_principal - principal;
    vault.total_shares = vault.total_shares - shares;

    let mut redeemed_balance = coin::into_balance(redeemed_coin);
    if (fee > 0) {
        let fee_balance = balance::split(&mut redeemed_balance, fee);
        balance::join(&mut revenue_vault.balance, fee_balance);
    };

    event::emit(WithdrawEvent {
        owner,
        protocol: vault.protocol,
        principal,
        gross_amount: gross,
        performance_fee: fee,
        user_amount,
    });

    coin::from_balance(redeemed_balance, ctx)
}

fun split_reward_internal<T>(
    config: &Config,
    revenue_vault: &mut RevenueVault<T>,
    reward: Coin<T>,
    owner: address,
    ctx: &mut TxContext,
): Coin<T> {
    let gross = coin::value(&reward);
    assert!(gross > 0, EZeroAmount);
    let fee = mul_div(gross, config.performance_fee_bps, FEE_DENOMINATOR_BPS);
    let user_amount = gross - fee;

    let mut reward_balance = coin::into_balance(reward);
    if (fee > 0) {
        let fee_balance = balance::split(&mut reward_balance, fee);
        balance::join(&mut revenue_vault.balance, fee_balance);
    };

    event::emit(RewardFeeEvent {
        owner,
        gross_amount: gross,
        protocol_fee: fee,
        user_amount,
    });

    coin::from_balance(reward_balance, ctx)
}

fun assert_admin(config: &Config, ctx: &TxContext) {
    assert!(config.admin == tx_context::sender(ctx), ENotAdmin);
}

fun mint_shares<P, T>(vault: &Vault<P, T>, amount: u64): u64 {
    let total_assets = balance::value(&vault.liquidity);
    if (vault.total_shares == 0 || total_assets == 0) {
        amount
    } else {
        mul_div(amount, vault.total_shares, total_assets)
    }
}

fun position_redeem_amount<P, T>(vault: &Vault<P, T>, position: &Position<P, T>): u64 {
    let total_assets = balance::value(&vault.liquidity);
    mul_div(total_assets, position.shares, vault.total_shares)
}

fun performance_fee(config: &Config, principal: u64, gross: u64): u64 {
    if (gross <= principal) {
        0
    } else {
        let profit = gross - principal;
        let fee = mul_div(profit, config.performance_fee_bps, FEE_DENOMINATOR_BPS);
        assert!(gross >= fee, EWithdrawTooSmallForFee);
        fee
    }
}

fun mul_div(value: u64, numerator: u64, denominator: u64): u64 {
    (((value as u128) * (numerator as u128) / (denominator as u128)) as u64)
}
