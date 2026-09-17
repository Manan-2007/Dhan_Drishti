import { z } from "zod";

/**
 * Canonical transaction model — the normalization target for every broker adapter.
 * All money/quantity fields are decimal STRINGS (never floats). See docs/SCHEMA.md.
 */

export const TX_TYPES = [
  "buy",
  "sell",
  "dividend",
  "interest",
  "deposit",
  "withdrawal",
  "fee",
  "tax",
  "transfer_in",
  "transfer_out",
  "split",
  "bonus",
] as const;
export type TxType = (typeof TX_TYPES)[number];

/** Types that change share quantity of a security. */
export const QTY_AFFECTING: ReadonlySet<TxType> = new Set<TxType>([
  "buy",
  "sell",
  "transfer_in",
  "transfer_out",
  "bonus",
]);

export const ASSET_CLASSES = [
  "equity",
  "etf",
  "mf",
  "bond",
  "reit_invit",
  "sgb",
  "crypto",
  "cash",
  "other",
] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

/** Reporting segments for the realised-P&L breakdown. */
export const SEGMENTS = ["equity", "mf", "fno", "commodity", "other"] as const;
export type Segment = (typeof SEGMENTS)[number];

const decimalString = z
  .string()
  .refine((s) => s.trim() !== "" && !Number.isNaN(Number(s)), "must be a numeric string");

export const CanonicalTxSchema = z.object({
  id: z.string(),
  userId: z.string(),
  portfolioId: z.string(),
  accountId: z.string().nullable().optional(),
  securityId: z.string().nullable().optional(),
  type: z.enum(TX_TYPES),
  tradeDate: z.string(), // ISO-8601 UTC
  settleDate: z.string().nullable().optional(),
  quantity: decimalString.default("0"),
  price: decimalString.default("0"),
  grossAmount: decimalString.default("0"),
  fees: decimalString.default("0"),
  taxes: decimalString.default("0"),
  currency: z.string().default("INR"),
  fxRateToBase: decimalString.nullable().optional(),
  segment: z.enum(SEGMENTS).default("equity"),
  externalRef: z.string().nullable().optional(),
  rawRowHash: z.string().nullable().optional(),
  sourceBroker: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type CanonicalTx = z.infer<typeof CanonicalTxSchema>;

export interface Security {
  id: string;
  symbol: string;
  isin?: string | null;
  amfiCode?: string | null;
  name: string;
  assetClass: AssetClass;
  subClass?: string | null;
  sector?: string | null;
  subSector?: string | null;
  currency: string;
  exchange?: string | null;
}

/** A cached, timestamped external quote. Absence => current value is unknown, not zero. */
export interface Quote {
  securityId: string;
  price: string;
  prevClose?: string | null;
  currency: string;
  asOf: string;
}
