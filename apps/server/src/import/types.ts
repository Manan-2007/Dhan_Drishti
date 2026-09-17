import type { TxType, Segment, AssetClass } from "@dhan-drishti/core";

/** A parsed CSV: header names (as-seen) plus row objects keyed by header. */
export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  rawLines: string[]; // original line text per row, for hashing
}

/** A security identity as read from a broker row (resolved against the master later). */
export interface SecurityRef {
  symbol: string;
  isin?: string;
  name?: string;
  amfiCode?: string;
  assetClass: AssetClass;
  exchange?: string;
}

/** The broker-independent shape an adapter emits per row (pre-persistence). */
export interface NormalizedTx {
  security: SecurityRef | null; // null for pure-cash rows
  type: TxType;
  tradeDate: string; // ISO-8601 UTC
  quantity: string;
  price: string;
  grossAmount: string;
  fees: string;
  taxes: string;
  currency: string;
  segment: Segment;
  externalRef?: string; // broker trade/order id — enables reliable dedup
}

export type NormalizedRow =
  | { ok: true; tx: NormalizedTx; rawHash: string; rowIndex: number }
  | { ok: false; error: string; raw: Record<string, string>; rowIndex: number };

export interface DetectResult {
  broker: string;
  confidence: number; // 0..1
  reason: string;
}

export interface BrokerAdapter {
  id: string;
  label: string;
  detect(csv: ParsedCsv): DetectResult;
  normalize(csv: ParsedCsv): NormalizedRow[];
}
