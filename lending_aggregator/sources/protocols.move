/// Phantom marker types for the lending protocols supported by this package.
module lending_aggregator::protocols;

const NAVI: u8 = 1;
const SCALLOP: u8 = 2;
const SUILEND: u8 = 3;
const BUCKET: u8 = 4;

public struct Navi has drop {}
public struct Scallop has drop {}
public struct Suilend has drop {}
public struct Bucket has drop {}

public fun navi(): u8 { NAVI }
public fun scallop(): u8 { SCALLOP }
public fun suilend(): u8 { SUILEND }
public fun bucket(): u8 { BUCKET }
