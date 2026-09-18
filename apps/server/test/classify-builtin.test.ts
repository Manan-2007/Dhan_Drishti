import { describe, it, expect } from "vitest";
import { classifyInstrument } from "../src/import/classify-builtin.js";

describe("built-in instrument classifier", () => {
  it("classifies commodity / debt / index instruments from the reference (and patterns)", () => {
    expect(classifyInstrument("LIQUIDCASE")).toMatchObject({ sector: "Debt" }); // liquid fund → Debt
    expect(classifyInstrument("GOLDBEES")).toMatchObject({ assetClass: "etf", sector: "Gold" });
    expect(classifyInstrument("SILVERBEES")).toMatchObject({ sector: "Silver" });
    expect(classifyInstrument("NIFTYBEES")).toMatchObject({ assetClass: "etf", sector: "Index" });
    // An SGB isn't in the ticker sheet → the pattern rule still classifies it as gold.
    expect(classifyInstrument("SGBJUN31I-GB", "Sovereign Gold Bond")).toMatchObject({ assetClass: "sgb", sector: "Gold" });
  });

  it("classifies REITs / InvITs", () => {
    expect(classifyInstrument("EMBASSY", "Embassy Office Parks REIT")).toMatchObject({ assetClass: "reit_invit", sector: "RealEstate" });
    expect(classifyInstrument("PGINVIT-IV", "Powergrid InvIT")).toMatchObject({ assetClass: "reit_invit" }); // series suffix tolerated
  });

  it("maps common equities to the reference sector taxonomy", () => {
    expect(classifyInstrument("RELIANCE")).toMatchObject({ sector: "Oil_Gas", source: "reference" });
    expect(classifyInstrument("INFY")).toMatchObject({ sector: "IT" });
    expect(classifyInstrument("HDFCBANK")).toMatchObject({ sector: "BFSI", subSector: "Pvt Banks" });
  });

  it("falls back to name keywords for name-based instruments (Dhan)", () => {
    expect(classifyInstrument("SOMEHOUSINGFIN", "Some Housing Finance")).toMatchObject({ sector: "BFSI" });
    expect(classifyInstrument("XYZ", "XYZ Refineries Petroleum")).toMatchObject({ sector: "Oil_Gas" });
    expect(classifyInstrument("ABC PHARMA", "ABC Pharma")).toMatchObject({ sector: "HealthCare" });
  });

  it("classifies F&O contracts as Derivatives, even when the name echoes the underlying", () => {
    expect(classifyInstrument("NIFTY25JAN25000CE")).toMatchObject({ assetClass: "other", sector: "Derivatives", subSector: "Options" });
    expect(classifyInstrument("BANKNIFTY2511250000PE")).toMatchObject({ sector: "Derivatives", subSector: "Options" }); // not Banks
    expect(classifyInstrument("RELIANCE25NOVFUT")).toMatchObject({ sector: "Derivatives", subSector: "Futures" }); // not Oil_Gas
  });

  it("does not mistake a company with 'Future' in its name for a derivative", () => {
    expect(classifyInstrument("FUTURERETAIL", "Future Retail")).not.toMatchObject({ sector: "Derivatives" });
  });

  it("returns null for a truly unknown symbol", () => {
    expect(classifyInstrument("ZZZUNKNOWN123")).toBeNull();
  });
});
