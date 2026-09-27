import { describe, it, expect } from "vitest";
import { findListing } from "../src/import/listings.js";

const sym = (name: string) => findListing({ name })?.symbol ?? null;

describe("findListing", () => {
  it("names Dhan's worded shares, however they're shortened", () => {
    expect(sym("POWER FINANCE CORPORATION")).toBe("PFC");
    expect(sym("COMPUTER AGE MNGT SER LTD")).toBe("CAMS");
    expect(sym("CAN FIN HOMES")).toBe("CANFINHOME");
    expect(sym("LARSEN & TOUBRO")).toBe("LT");
    expect(sym("HINDUSTAN PETROLEUM")).toBe("HINDPETRO");
    expect(sym("INDIAN OIL CORPORATION")).toBe("IOC");
  });

  it("puts every spelling of one company on one ticker", () => {
    expect(sym("KOTAK MAHINDRA BANK LTD")).toBe("KOTAKBANK");
    expect(sym("KOTAK MAHINDRA BANK LTD.")).toBe("KOTAKBANK");
    expect(sym("KOTAK BANK")).toBe("KOTAKBANK");
  });

  it("finds ETFs by fund house, index and initials", () => {
    expect(sym("MIRAE AST NIFTY SMALLCAP 250 MQ 100 ETF")).toBe("SMALLCAP");
    expect(sym("MOTILAL OSWAL NIFTY 500 MOMENTUM 50 ETF")).toBe("MOMENTUM50");
    expect(sym("HDFC NIFTY SMALL CAP 250 ETF")).toBe("HDFCSML250");
    expect(sym("HDFC Silver ETF")).toBe("HDFCSILVER");
    expect(sym("Nippon Nifty Bank ETF (BANKBEES)")).toBe("BANKBEES");
    expect(sym("MINDSPACE BUSINESS PARKS REIT")).toBe("MINDSPACE");
  });

  it("prefers the ISIN, then a ticker, and refuses to guess", () => {
    expect(findListing({ isin: "INE134E01011", name: "anything" })?.symbol).toBe("PFC");
    expect(findListing({ symbol: "RELIANCE" })?.isin).toBe("INE002A01018");
    expect(sym("BANK")).toBeNull(); // dozens of banks
    expect(sym("TATA")).toBeNull();
    expect(sym("SOME PRIVATE COMPANY NOBODY LISTED")).toBeNull();
  });
});

describe("imports land worded shares on their listing", () => {
  it("merges a Dhan name with the Zerodha ticker for the same company", async () => {
    const { createDb } = await import("../src/db/index.js");
    const { buildApp } = await import("../src/app.js");
    const { db } = await createDb(":memory:");
    const app = buildApp(db);
    await app.ready();
    const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "canon1", password: "supersecret1" } });
    const raw = res.headers["set-cookie"];
    const cookie = (Array.isArray(raw) ? raw[0]! : (raw as string)).split(";")[0]!;
    const post = (url: string, payload: unknown) => app.inject({ method: "POST", url, headers: { cookie }, payload });
    const pid = (await post("/api/portfolios", { name: "P" })).json().portfolio.id;
    await post("/api/imports/commit", { portfolioId: pid, broker: "zerodha", filename: "z.csv", content: "symbol,isin,trade_date,exchange,segment,trade_type,quantity,price,trade_id\nKOTAKBANK,INE237A01028,2025-04-02,NSE,EQ,buy,5,1900,1" });
    await post("/api/imports/commit", {
      portfolioId: pid,
      broker: "dhan-txn",
      filename: "d.csv",
      content: [
        "Date,Scrip Name,Exchange,Bill No.,Buy Qty.,Buy Value,Sell Qty.,Sell Value,Brokerage,GST,STT,SEBI Fees,Stamp Duty,Txn. Charges,Oth. Charges,Gross Amount",
        '"03 Apr 2025 00:00:00","KOTAK BANK","NSE","1","3","5700.00","0","0.00","0","0","0","0","0","0","0","-5700.00"',
        '"04 Apr 2025 00:00:00","KOTAK MAHINDRA BANK LTD.","NSE","2","2","3800.00","0","0.00","0","0","0","0","0","0","0","-3800.00"',
      ].join("\n"),
    });
    const h = (await app.inject({ method: "GET", url: "/api/holdings", headers: { cookie } })).json().holdings as { security: { symbol: string }; netQty: string }[];
    expect(h.map((x) => [x.security.symbol, x.netQty])).toEqual([["KOTAKBANK", "10"]]);
  });
});
