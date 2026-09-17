/**
 * The catalogue of indices the user can compare their portfolio against. The client picks a
 * benchmark by `id`; only these curated public index symbols are ever sent to the provider
 * (no arbitrary symbols reach Yahoo). Add rows here to offer more benchmarks.
 */
export interface Benchmark {
  id: string;
  label: string;
  symbol: string; // provider (Yahoo) index symbol
  currency: string;
}

export const BENCHMARKS: Benchmark[] = [
  { id: "nifty50", label: "Nifty 50", symbol: "^NSEI", currency: "INR" },
  { id: "sensex", label: "BSE Sensex", symbol: "^BSESN", currency: "INR" },
  { id: "niftybank", label: "Nifty Bank", symbol: "^NSEBANK", currency: "INR" },
  { id: "niftyit", label: "Nifty IT", symbol: "^CNXIT", currency: "INR" },
];

export function getBenchmark(id: string): Benchmark | undefined {
  return BENCHMARKS.find((b) => b.id === id);
}
