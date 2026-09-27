import { ColorType, CrosshairMode, createChart, type Time } from "lightweight-charts";
import { compactMoney } from "@/lib/format";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Lightweight Charts hands business-day times back as "YYYY-MM-DD" strings or {year,month,day}. */
export function dayLabel(time: Time, withYear = false): string {
  let y: number, m: number, d: number;
  if (typeof time === "string") [y, m, d] = time.split("-").map(Number) as [number, number, number];
  else if (typeof time === "number") {
    const dt = new Date(time * 1000);
    [y, m, d] = [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
  } else [y, m, d] = [time.year, time.month, time.day];
  return `${d} ${MONTHS[m - 1] ?? ""}${withYear ? ` ${y}` : ""}`;
}

/** The app's chart look: transparent, quiet grid, ivory-grey text, no scroll or zoom. */
export function themedChart(el: HTMLElement) {
  return createChart(el, {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: "transparent" },
      textColor: "#9c978c",
      fontFamily: "IBM Plex Sans Variable, ui-sans-serif, system-ui",
      fontSize: 11,
      attributionLogo: false,
    },
    grid: { vertLines: { visible: false }, horzLines: { color: "#1d1d22" } },
    rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
    timeScale: {
      borderVisible: false,
      fixLeftEdge: true,
      fixRightEdge: true,
      lockVisibleTimeRangeOnResize: true,
      tickMarkFormatter: (time: Time) => dayLabel(time),
    },
    crosshair: {
      mode: CrosshairMode.Magnet,
      vertLine: { color: "#3a3a42", width: 1, style: 0, labelBackgroundColor: "#26262c" },
      horzLine: { color: "#3a3a42", width: 1, style: 2, labelBackgroundColor: "#26262c" },
    },
    handleScroll: false,
    handleScale: false,
    localization: { priceFormatter: (p: number) => compactMoney(p), timeFormatter: (time: Time) => dayLabel(time, true) },
  });
}

/** Lightweight Charts needs strictly ascending, unique times; the last value for a day wins. */
export function byDay(points: { time: string; value: number }[]) {
  const seen = new Map<string, number>();
  for (const p of points) seen.set(p.time, p.value);
  return [...seen.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([time, value]) => ({ time: time as Time, value }));
}
