import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.js";
import { useFilter } from "./hooks.js";

export interface RefreshResult {
  requested: number;
  updated: number;
  failed: number;
}

/** When prices were last fetched for the current scope (null = never). */
export function useMarketStatus() {
  const { portfolioId } = useFilter();
  return useQuery({
    queryKey: ["market-status", portfolioId],
    queryFn: () =>
      api.get<{ provider: string; lastUpdated: string | null }>(`/api/market-data/status${portfolioId ? `?portfolioId=${portfolioId}` : ""}`),
  });
}

/** Refresh prices + FX for the current scope, then invalidate every view that reads them. */
export function useRefreshPrices() {
  const qc = useQueryClient();
  const { portfolioId } = useFilter();
  return useMutation({
    mutationFn: async () => {
      const prices = await api.post<RefreshResult>("/api/market-data/refresh", portfolioId ? { portfolioId } : {});
      // FX: value foreign holdings in base currency, and backfill FX-at-cost for the return split.
      await api.post("/api/exchange-rates/refresh", {}).catch(() => undefined);
      await api.post("/api/exchange-rates/backfill", {}).catch(() => undefined);
      return prices;
    },
    onSuccess: () => {
      for (const key of ["holdings", "performance", "dividends", "market-status", "networth", "security-detail", "rebalance", "attention"]) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}
