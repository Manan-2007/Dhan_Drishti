import type { Fundamentals, FundamentalsProvider } from "./yahoo-fundamentals.js";

/**
 * Fundamentals for US listings from Nasdaq's public quote and company APIs (no key, no handshake):
 * the quote summary (market cap, yield, 52-week range, analyst target), the company's reported
 * financial statements, and the analyst consensus. Valuation and profitability are worked out from
 * those reported figures — P/E is market cap over the last four quarters' net income, margins are
 * those quarters' profit over revenue, growth compares the last two fiscal years. Only the public
 * ticker is sent. Anything missing stays null; nothing is estimated.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

type Row = Record<string, string | null | undefined>;
interface Table {
  headers?: Row;
  rows?: Row[];
}

/** "$96,222,000" → 96222000; "-$102,000" → -102000; "--" / "" / "N/A" → null. */
export function parseAmount(v: string | null | undefined): number | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s === "--" || /^n\/?a$/i.test(s)) return null;
  const neg = s.startsWith("-") || s.startsWith("(");
  const n = Number(s.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || s.replace(/[^0-9]/g, "") === "") return null;
  return neg ? -n : n;
}

/** A statement row's values, newest first (value2, value3, …). Nasdaq reports them in thousands. */
function series(t: Table | undefined, label: string): (number | null)[] {
  const row = t?.rows?.find((r) => (r.value1 ?? "").trim().toLowerCase() === label.toLowerCase());
  if (!row) return [];
  const out: (number | null)[] = [];
  for (let i = 2; i <= 6; i++) {
    const key = `value${i}`;
    if (!(key in row)) break;
    const n = parseAmount(row[key]);
    out.push(n === null ? null : n * 1000);
  }
  return out;
}

const sum4 = (xs: (number | null)[]) => (xs.length >= 4 && xs.slice(0, 4).every((x) => x !== null) ? xs.slice(0, 4).reduce((a, b) => a! + b!, 0)! : null);
const ratio = (a: number | null, b: number | null) => (a !== null && b !== null && b !== 0 ? a / b : null);

export class NasdaqFundamentalsProvider implements FundamentalsProvider {
  readonly id = "nasdaq";
  constructor(private timeoutMs = 12000) {}

  private async get<T>(path: string): Promise<T | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(`https://api.nasdaq.com/api/${path}`, { headers: { "user-agent": UA, accept: "application/json" }, signal: ctrl.signal });
      if (!res.ok) return null;
      const json = (await res.json()) as { data?: T | null };
      return json.data ?? null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async getFundamentals(tickerRaw: string): Promise<Fundamentals | null> {
    // US listings only: Indian tickers carry an exchange suffix (.NS / .BO).
    if (/\.(NS|BO)$/i.test(tickerRaw)) return null;
    const ticker = tickerRaw.toUpperCase().replace(/-/g, ".");
    const sym = encodeURIComponent(ticker);
    const summary = await this.get<{ summaryData?: Record<string, { label?: string; value?: string }> }>(`quote/${sym}/summary?assetclass=stocks`);
    const etfSummary = summary?.summaryData ? null : await this.get<{ summaryData?: Record<string, { label?: string; value?: string }> }>(`quote/${sym}/summary?assetclass=etf`);
    const sd = summary?.summaryData ?? etfSummary?.summaryData;
    if (!sd) return null;
    const field = (...labels: string[]) => Object.values(sd).find((f) => labels.some((l) => (f.label ?? "").toLowerCase().startsWith(l.toLowerCase())))?.value ?? null;

    const marketCap = parseAmount(field("Market Cap"));
    const prevClose = parseAmount(field("Previous Close"));
    const [hi, lo] = (field("52 Week High/Low") ?? "").split("/").map((x) => parseAmount(x));
    const yieldPct = parseAmount(field("Current Yield", "Yield"));
    const target = parseAmount(field("1 Year Target"));

    const isEtf = !summary?.summaryData;
    const [quarterly, annual, ratings] = isEtf
      ? [null, null, null]
      : await Promise.all([
          this.get<{ incomeStatementTable?: Table; balanceSheetTable?: Table }>(`company/${sym}/financials?frequency=2`),
          this.get<{ incomeStatementTable?: Table }>(`company/${sym}/financials?frequency=1`),
          this.get<{ meanRatingType?: string; ratingsSummary?: string }>(`analyst/${sym}/ratings`),
        ]);

    const revTtm = sum4(series(quarterly?.incomeStatementTable, "Total Revenue"));
    const niTtm = sum4(series(quarterly?.incomeStatementTable, "Net Income"));
    const opTtm = sum4(series(quarterly?.incomeStatementTable, "Operating Income"));
    const equity = series(quarterly?.balanceSheetTable, "Total Equity")[0] ?? null;
    const revY = series(annual?.incomeStatementTable, "Total Revenue");
    const niY = series(annual?.incomeStatementTable, "Net Income");
    const shares = marketCap !== null && prevClose ? marketCap / prevClose : null;

    const rating = ratings?.meanRatingType?.trim().toLowerCase().replace(/\s+/g, "_") || null;
    const analysts = ratings?.ratingsSummary?.match(/(\d+)\s+analyst/i)?.[1];

    return {
      currency: "USD",
      marketCap,
      trailingPE: marketCap !== null && niTtm !== null && niTtm > 0 ? marketCap / niTtm : null,
      forwardPE: null,
      priceToBook: equity !== null && equity > 0 ? ratio(marketCap, equity) : null,
      pegRatio: null,
      profitMargin: ratio(niTtm, revTtm),
      operatingMargin: ratio(opTtm, revTtm),
      revenueGrowth: revY[0] != null && revY[1] ? revY[0] / revY[1] - 1 : null,
      earningsGrowth: niY[0] != null && niY[1] && niY[1] > 0 ? niY[0] / niY[1] - 1 : null,
      returnOnEquity: equity !== null && equity > 0 ? ratio(niTtm, equity) : null,
      dividendYield: yieldPct !== null ? yieldPct / 100 : null,
      eps: ratio(niTtm, shares),
      bookValue: ratio(equity, shares),
      fiftyTwoWeekLow: lo ?? null,
      fiftyTwoWeekHigh: hi ?? null,
      dayLow: null,
      dayHigh: null,
      targetMeanPrice: target,
      recommendationKey: rating,
      numberOfAnalysts: analysts ? Number(analysts) : null,
      asOf: new Date().toISOString(),
      source: "Nasdaq",
    };
  }
}
