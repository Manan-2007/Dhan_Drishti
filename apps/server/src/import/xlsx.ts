import * as XLSX from "xlsx";
import { parseCsv } from "./csv.js";
import type { BrokerAdapter } from "./types.js";

/** True for an Excel workbook: a `.xls*` filename, or the ZIP magic ("PK") that starts every .xlsx. */
export function looksLikeXlsx(buf: Buffer, filename?: string): boolean {
  if (filename && /\.(xlsx|xlsm|xlsb|xls)$/i.test(filename)) return true;
  // .xlsx is a ZIP → starts with "PK\x03\x04"; the legacy .xls (OLE) starts with 0xD0 0xCF.
  return (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b) || (buf.length >= 2 && buf[0] === 0xd0 && buf[1] === 0xcf);
}

/**
 * Convert a workbook to the CSV of whichever sheet the adapter can actually read — broker Excel
 * exports carry several sheets (Vested's file has "My Account", "All Transactions", "Trades",
 * "Transfers", "Income"…), so picking the right one matters. We score each sheet by the adapter's
 * detection confidence, then by how many rows it normalizes cleanly, and fall back to the largest
 * sheet when nothing matches so the caller's "format_unrecognized" error stays meaningful.
 */
export function workbookToCsv(buf: Buffer, adapter?: BrokerAdapter): string {
  const wb = XLSX.read(buf, { type: "buffer" });
  let best: { csv: string; conf: number; valid: number } | null = null;
  let largest: { csv: string; rows: number } | null = null;
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false });
    const parsed = parseCsv(csv);
    if (parsed.rows.length === 0) continue;
    if (!largest || parsed.rows.length > largest.rows) largest = { csv, rows: parsed.rows.length };
    if (!adapter) continue;
    const conf = adapter.detect(parsed).confidence;
    if (conf <= 0) continue;
    const valid = adapter.normalize(parsed).reduce((n, r) => n + (r.ok ? 1 : 0), 0);
    if (!best || conf > best.conf || (conf === best.conf && valid > best.valid)) best = { csv, conf, valid };
  }
  return best?.csv ?? largest?.csv ?? "";
}
