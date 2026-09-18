import { describe, it, expect } from "vitest";
import { classifyInstrument } from "../src/import/classify-builtin.js";

describe("built-in instrument classifier", () => {
  it("classifies commodity / debt / SGB ETFs by pattern", () => {
    expect(classifyInstrument("LIQUIDCASE")).toMatchObject({ assetClass: "cash", sector: "Debt", subSector: "Liquid" });
    expect(classifyInstrument("GOLDBEES")).toMatchObject({ assetClass: "etf", sector: "Commodity", subSector: "Gold" });
    expect(classifyInstrument("SILVERBEES")).toMatchObject({ sector: "Commodity", subSector: "Silver" });
    expect(classifyInstrument("SGBJUN31I-GB", "Sovereign Gold Bond")).toMatchObject({ assetClass: "sgb", sector: "Commodity" });
    expect(classifyInstrument("NIFTYBEES")).toMatchObject({ sector: "Equity: Index" });
  });

  it("classifies REITs", () => {
    expect(classifyInstrument("EMBASSY", "Embassy Office Parks REIT")).toMatchObject({ assetClass: "reit_invit", sector: "REIT / InvIT" });
  });

  it("maps common equities to sectors", () => {
    expect(classifyInstrument("RELIANCE")).toMatchObject({ sector: "Energy", subSector: "Oil & Gas" });
    expect(classifyInstrument("INFY")).toMatchObject({ sector: "IT" });
    expect(classifyInstrument("HDFCBANK")).toMatchObject({ sector: "Financials", subSector: "Banks" });
    expect(classifyInstrument("PFC")).toMatchObject({ sector: "Financials", subSector: "NBFC" });
  });

  it("falls back to name keywords for name-based instruments (Dhan)", () => {
    expect(classifyInstrument("POWER FINANCE CORPORATION", "Power Finance Corporation")).toMatchObject({ sector: "Financials" });
    expect(classifyInstrument("INDIAN OIL CORPORATION", "Indian Oil Corporation")).toMatchObject({ sector: "Energy" });
    expect(classifyInstrument("INDRAPRASTHA GAS", "Indraprastha Gas")).toMatchObject({ sector: "Energy" });
    expect(classifyInstrument("APL APOLLO TUBES", "APL Apollo Tubes")).toMatchObject({ sector: "Metals" });
  });

  it("returns null for a truly unknown symbol", () => {
    expect(classifyInstrument("ZZZUNKNOWN123")).toBeNull();
  });
});
