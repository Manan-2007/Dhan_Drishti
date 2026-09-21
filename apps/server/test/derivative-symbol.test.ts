import { describe, it, expect } from "vitest";
import { parseDerivativeSymbol, underlyingYahooSymbol } from "../src/market/derivative-symbol.js";

describe("parseDerivativeSymbol — Zerodha raw NSE trading symbols", () => {
  it("parses a NIFTY option", () => {
    expect(parseDerivativeSymbol("NIFTY25JUN26000CE")).toEqual({
      kind: "option",
      underlying: "NIFTY",
      expiryISO: "2025-06-30",
      strike: 26000,
      optionType: "CE",
    });
  });

  it("parses a BANKNIFTY put", () => {
    const r = parseDerivativeSymbol("BANKNIFTY25MAY55000PE");
    expect(r).toMatchObject({ kind: "option", underlying: "BANKNIFTY", strike: 55000, optionType: "PE" });
  });

  it("parses a single-stock future", () => {
    expect(parseDerivativeSymbol("RELIANCE25JUNFUT")).toEqual({
      kind: "future",
      underlying: "RELIANCE",
      expiryISO: "2025-06-30",
    });
  });

  it("returns null for a plain equity symbol", () => {
    expect(parseDerivativeSymbol("RELIANCE")).toBeNull();
    expect(parseDerivativeSymbol("HDFCBANK")).toBeNull();
  });
});

describe("parseDerivativeSymbol — Dhan descriptive form", () => {
  it("parses an OPT row with an exact day", () => {
    expect(parseDerivativeSymbol("OPT NIFTY 30 JUN 2026 24000 PE")).toEqual({
      kind: "option",
      underlying: "NIFTY",
      expiryISO: "2026-06-30",
      strike: 24000,
      optionType: "PE",
    });
  });

  it("parses a FUT row with an exact day", () => {
    expect(parseDerivativeSymbol("FUT ICICIBANK 28 AUG 2025")).toEqual({
      kind: "future",
      underlying: "ICICIBANK",
      expiryISO: "2025-08-28",
    });
  });

  it("parses a commodity future (underlying will fail to resolve later, but the symbol parses)", () => {
    expect(parseDerivativeSymbol("FUT SILVERMIC 30 APR 2026")).toEqual({
      kind: "future",
      underlying: "SILVERMIC",
      expiryISO: "2026-04-30",
    });
  });

  it("falls back to name when the symbol itself doesn't parse", () => {
    expect(parseDerivativeSymbol("OPT NIFTY 30 JUN 2026 24000 PE", "OPT NIFTY 30 JUN 2026 24000 PE")).toMatchObject({ kind: "option" });
  });
});

describe("underlyingYahooSymbol", () => {
  it("maps known indices to their Yahoo alias", () => {
    expect(underlyingYahooSymbol("NIFTY")).toBe("^NSEI");
    expect(underlyingYahooSymbol("BANKNIFTY")).toBe("^NSEBANK");
  });

  it("maps a stock underlying to its NSE Yahoo ticker", () => {
    expect(underlyingYahooSymbol("ICICIBANK")).toBe("ICICIBANK.NS");
  });
});
