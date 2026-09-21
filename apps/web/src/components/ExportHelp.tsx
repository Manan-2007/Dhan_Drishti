import { useState } from "react";

/** Per-upload-type instructions for getting the right file from each broker — the #1 onboarding
 *  hurdle is not the upload but knowing which export to download and where it lives. */
const GUIDES: Record<string, { where: string; steps: string[]; note?: string }> = {
  cas: {
    where: "CAMS / KFintech → Consolidated Account Statement (CAS)",
    steps: [
      "Go to camsonline.com (or the MF Central app / KFintech) → 'CAS - CAMS+KFintech'.",
      "Choose the Detailed statement, period 'Since Inception', and enter your email + a password.",
      "You'll receive the password-protected PDF by email — upload it here and enter that password (often your PAN).",
    ],
    note: "One statement covers every mutual fund across all AMCs — no per-fund files needed.",
  },
  zerodha: {
    where: "Zerodha Console → Reports → Tradebook",
    steps: [
      "Open console.zerodha.com and sign in.",
      "Go to Reports → Tradebook.",
      "Pick the segment — Equity, or F&O — and a date range (a full financial year works well).",
      "Click the download icon and choose CSV.",
    ],
    note: "Import Equity and F&O as separate files.",
  },
  "zerodha-holdings": {
    where: "Zerodha Console → Portfolio → Holdings",
    steps: [
      "Open console.zerodha.com → Portfolio → Holdings.",
      "Click the download icon (top-right of the holdings table).",
      "Save the Excel (.xlsx) file and upload it here.",
    ],
    note: "The holdings statement is an .xlsx — upload it as-is.",
  },
  "dhan-txn": {
    where: "Dhan → Reports → All Transactions",
    steps: [
      "Open web.dhan.co (or the app) → Reports.",
      "Choose the All Transaction Report.",
      "Set the date range and export as CSV.",
    ],
    note: "This one file carries equity, ETF and mutual-fund trades together.",
  },
  dhan: {
    where: "Dhan → Reports → Tradebook",
    steps: ["Open Dhan → Reports → Tradebook.", "Set a date range and export as CSV."],
  },
  "dhan-holdings": {
    where: "Dhan → Holdings",
    steps: [
      "Open Dhan → Holdings.",
      "Export the holdings statement (CSV).",
      "Upload it here to refresh current prices for your Dhan positions.",
    ],
    note: "This only updates prices — import the transaction report first for cost and quantity.",
  },
  funds: {
    where: "Dhan → Reports → Funds Summary (or your broker's ledger)",
    steps: [
      "Open your broker's funds / ledger statement.",
      "Set the date range and export as CSV.",
    ],
    note: "Deposits and withdrawals let the app show your true invested amount and cash.",
  },
  dividends: {
    where: "Dhan → Reports → Dividend Payout (or your broker's dividend statement)",
    steps: ["Open the dividend / payout statement.", "Set the date range and export as CSV."],
  },
  vested: {
    where: "Vested → Account → Reports / Statements",
    steps: [
      "Open the Vested app or app.vested.co.in → Account.",
      "Export your transactions / statement (an Excel .xlsx).",
      "Upload it here — the app reads the Trades sheet automatically.",
    ],
    note: "US holdings are in USD; the app converts to your base currency.",
  },
  ibkr: {
    where: "IBKR → Performance & Reports → Statements",
    steps: [
      "In Client Portal, open Performance & Reports → Statements (or a Flex Query).",
      "Choose Activity, set the period, and export as CSV.",
    ],
  },
  binance: {
    where: "Binance → Wallet → Transaction History",
    steps: [
      "Open Binance → Wallet → Transaction History.",
      "Use Generate all statements / Export and download the CSV.",
    ],
  },
  holdings: {
    where: "Your broker → Holdings / Portfolio → Download",
    steps: [
      "Open your broker's Holdings or Portfolio page.",
      "Download the snapshot (CSV or Excel) — it should include quantity and average cost.",
    ],
  },
  generic: {
    where: "Any broker export (CSV)",
    steps: [
      "Export any transactions CSV from your broker.",
      "On the next screen, map its columns (symbol, date, buy/sell, quantity, price).",
    ],
  },
};

export function ExportHelp({ broker }: { broker: string }) {
  const [open, setOpen] = useState(false);
  const guide = GUIDES[broker];
  if (!guide) return null;

  return (
    <div className="rounded-md border bg-background">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm"
      >
        <span className="flex items-center gap-2 font-medium">
          <span aria-hidden>❔</span> How to get this file
        </span>
        <span className="text-muted-foreground">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="border-t px-3 py-3 text-sm">
          <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">{guide.where}</p>
          <ol className="ml-4 list-decimal space-y-1 text-muted-foreground">
            {guide.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          {guide.note && <p className="mt-2 text-xs text-muted-foreground">{guide.note}</p>}
        </div>
      )}
    </div>
  );
}
