/** Brokers people pick from when setting up — the ids match the server's account `broker` enum. */
export const BROKER_CHOICES: { id: string; label: string; hint?: string }[] = [
  { id: "zerodha", label: "Zerodha" },
  { id: "dhan", label: "Dhan" },
  { id: "vested", label: "Vested", hint: "US stocks" },
  { id: "ibkr", label: "Interactive Brokers" },
  { id: "binance", label: "Binance", hint: "crypto" },
  { id: "generic", label: "Other broker" },
];

const LABELS: Record<string, string> = { ...Object.fromEntries(BROKER_CHOICES.map((b) => [b.id, b.label])), manual: "Entered by hand", crypto: "Crypto" };

export const brokerLabel = (id: string | null | undefined): string => (id ? (LABELS[id] ?? id) : "Broker");

/** Personal use = a single portfolio that isn't a family member's. */
export const isPersonal = (people: { kind: string }[] | undefined): boolean => !!people && people.length === 1 && people[0]!.kind !== "family";
