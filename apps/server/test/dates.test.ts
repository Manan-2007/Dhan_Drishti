import { describe, it, expect } from "vitest";
import { canonicalDate, IST, UTC, US_EASTERN } from "../src/import/dates.js";
import { financialYear } from "@dhan-drishti/core";

// Every expectation must hold on any machine (try TZ=UTC / TZ=America/New_York), because the
// answer can't depend on where the server happens to run.
describe(`canonicalDate (TZ=${process.env.TZ ?? "system"})`, () => {
  it("files a date-only row at UTC midnight of the printed date", () => {
    expect(canonicalDate("2025-04-01", IST)).toBe("2025-04-01T00:00:00.000Z");
    expect(canonicalDate("01 Apr 2025 00:00:00", IST)).toBe("2025-04-01T00:00:00.000Z"); // Dhan statement
    expect(canonicalDate("04/01/2025", US_EASTERN)).toBe("2025-04-01T00:00:00.000Z"); // US MM/DD/YYYY
  });

  it("keeps a 1 April trade in the new financial year", () => {
    expect(financialYear(canonicalDate("01 Apr 2025 00:00:00", IST)!)).toBe("FY 25-26");
  });

  it("reads a zone-less time in the broker's zone", () => {
    expect(canonicalDate("2025-04-01T09:15:26", IST)).toBe("2025-04-01T03:45:26.000Z");
    expect(canonicalDate("2025-04-01 09:15:26", IST)).toBe("2025-04-01T03:45:26.000Z");
    expect(canonicalDate("2024-01-02 10:30:00", UTC)).toBe("2024-01-02T10:30:00.000Z");
    expect(canonicalDate("2024-01-02 10:30:00", US_EASTERN)).toBe("2024-01-02T15:30:00.000Z");
  });

  it("honours an explicit zone", () => {
    expect(canonicalDate("2025-04-01T09:15:26+05:30", UTC)).toBe("2025-04-01T03:45:26.000Z");
    expect(canonicalDate("2025-04-01T03:45:26Z", IST)).toBe("2025-04-01T03:45:26.000Z");
  });

  it("does not mistake a DD-MM-YYYY tail for a zone, and rejects junk", () => {
    expect(canonicalDate("2025-04-01", IST)).not.toBeNull();
    expect(canonicalDate("", IST)).toBeNull();
    expect(canonicalDate(undefined, IST)).toBeNull();
    expect(canonicalDate("not a date", IST)).toBeNull();
  });
});
