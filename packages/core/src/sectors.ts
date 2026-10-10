/**
 * Display names for the sector vocabulary shared by Indian (NSE reference) and US (Nasdaq reference)
 * holdings. Stored keys stay short and stable; people see these.
 */
const SECTOR_LABELS: Record<string, string> = {
  IT: "IT & software",
  BFSI: "Banking & finance",
  HealthCare: "Healthcare",
  FMCG: "FMCG & staples",
  Consumer: "Consumer & retail",
  CapitalGoods: "Capital goods & industrials",
  Oil_Gas: "Oil & gas",
  Energy: "Power & utilities",
  RealEstate: "Real estate",
  Metal: "Metals & materials",
  Chemicals: "Chemicals",
  TeleCom: "Telecom",
  Auto: "Auto",
  Defence: "Defence & aerospace",
  Infra: "Infrastructure",
  Hospitality: "Hotels & travel",
  Misc: "Other",
  Index: "Index funds",
  Sectorial: "Sector & theme funds",
  Global: "International funds",
  Income: "Income funds",
  Debt: "Debt",
  Gold: "Gold",
  Silver: "Silver",
  Flexi: "Flexi-cap funds",
  LargeMid: "Large & mid-cap funds",
  SmallCap: "Small-cap funds",
  MidCap: "Mid-cap funds",
  ELSS: "Tax-saving funds (ELSS)",
  Hybrid: "Hybrid funds",
  Derivatives: "F&O",
};

/** A sector key as people should read it ("Oil_Gas" → "Oil & gas"); unknown keys pass through. */
export function sectorLabel(key: string | null | undefined): string {
  if (!key) return "Unclassified";
  return SECTOR_LABELS[key] ?? key;
}
