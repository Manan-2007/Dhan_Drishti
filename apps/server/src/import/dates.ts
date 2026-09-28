/**
 * Broker dates → the canonical ISO timestamp, the same on every machine.
 *
 * The convention (the CAS importer and manual entry already follow it): a row that only carries a
 * DATE is stored at UTC midnight of that calendar date, so `tradeDate.slice(0, 10)` and the UTC
 * getters (financial year, daily series) always see the date the broker printed. A row with a real
 * TIME is stored as the true instant, reading the wall-clock in the broker's own zone.
 *
 * Plain `new Date(Date.parse(s)).toISOString()` gets both wrong: it reads a zone-less string in the
 * server's timezone, so on an Indian machine "01 Apr 2025 00:00:00" became 31 Mar 18:30 UTC — and
 * a 1 April trade was filed under the previous financial year.
 */

/** Minutes east of UTC. */
export const IST = 330;
export const UTC = 0;
/** US brokers: New York standard time. Only orders a day's trades; never moves the date. */
export const US_EASTERN = -300;

const HAS_ZONE = /\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(?:z|[+-]\d{2}:?\d{2})$/i;

/**
 * `raw` is anything `Date.parse` understands without a zone ("2025-04-01", "2025-04-01 09:15:26",
 * "01 Apr 2025 00:00:00", "04/01/2025"); an explicit zone is always honoured. Midnight means
 * "no time given" — no exchange trades at 00:00:00.
 */
export function canonicalDate(raw: string | undefined | null, zoneMinutes: number): string | null {
  const s = raw?.trim();
  if (!s) return null;
  if (HAS_ZONE.test(s)) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  // A bare ISO date parses as UTC but everything else as local time; make it local like the rest,
  // so the local getters below read back exactly the wall-clock the file printed.
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00` : s);
  if (Number.isNaN(t)) return null;
  const w = new Date(t);
  const [y, mo, d, h, mi, sec] = [w.getFullYear(), w.getMonth(), w.getDate(), w.getHours(), w.getMinutes(), w.getSeconds()];
  if (y < 1900 || y > 2200) return null;
  if (h === 0 && mi === 0 && sec === 0) return new Date(Date.UTC(y, mo, d)).toISOString();
  return new Date(Date.UTC(y, mo, d, h, mi, sec) - zoneMinutes * 60_000).toISOString();
}
