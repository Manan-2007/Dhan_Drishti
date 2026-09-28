import { describe, it, expect } from "vitest";
import { displayName, readableContract } from "./instrument";

describe("readable contract names", () => {
  it("reads Zerodha monthly options and futures", () => {
    expect(readableContract("NIFTY26MAY21500PE")).toEqual({ title: "NIFTY 21,500 PE", expiry: "May 2026 expiry" });
    expect(readableContract("RELIANCE25JUNFUT")).toEqual({ title: "RELIANCE FUT", expiry: "Jun 2025 expiry" });
  });

  it("reads Zerodha weeklies with their exact day", () => {
    expect(readableContract("NIFTY2560524000CE")).toEqual({ title: "NIFTY 24,000 CE", expiry: "5 Jun 2025 expiry" });
  });

  it("reads Dhan's descriptive form", () => {
    expect(readableContract("OPT NIFTY 26 JUN 2025 25000 CE")).toEqual({ title: "NIFTY 25,000 CE", expiry: "26 Jun 2025 expiry" });
    expect(readableContract("FUT GOLDM 02 APR 2026")).toEqual({ title: "GOLDM FUT", expiry: "2 Apr 2026 expiry" });
  });

  it("leaves shares and funds as they are", () => {
    expect(readableContract("HDFCBANK")).toBeNull();
    expect(readableContract("NIFTYBEES")).toBeNull();
    expect(displayName({ symbol: "INFY" })).toBe("INFY");
  });
});
