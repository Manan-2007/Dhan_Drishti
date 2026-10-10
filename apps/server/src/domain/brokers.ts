/** Brokers an account can belong to. Kept in its own module so portfolios and accounts can both use it. */
export const BROKERS = ["zerodha", "dhan", "vested", "ibkr", "binance", "crypto", "generic", "manual"] as const;
export type Broker = (typeof BROKERS)[number];
