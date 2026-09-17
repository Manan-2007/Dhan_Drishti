import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api.js";
import { useFilter } from "../lib/hooks.js";
import { Button } from "./ui.js";

interface RefreshResult {
  requested: number;
  updated: number;
  failed: number;
}

export function RefreshButton() {
  const qc = useQueryClient();
  const { portfolioId } = useFilter();
  const [msg, setMsg] = useState<string | null>(null);

  const status = useQuery({
    queryKey: ["market-status", portfolioId],
    queryFn: () =>
      api.get<{ provider: string; lastUpdated: string | null }>(
        `/api/market-data/status${portfolioId ? `?portfolioId=${portfolioId}` : ""}`,
      ),
  });

  const refresh = useMutation({
    mutationFn: async () => {
      const prices = await api.post<RefreshResult>("/api/market-data/refresh", portfolioId ? { portfolioId } : {});
      // Also refresh FX (value foreign holdings in base) and backfill FX-at-cost (return split).
      await api.post("/api/exchange-rates/refresh", {}).catch(() => undefined);
      await api.post("/api/exchange-rates/backfill", {}).catch(() => undefined);
      return prices;
    },
    onSuccess: (r) => {
      setMsg(`Priced ${r.updated}/${r.requested}${r.failed ? ` · ${r.failed} unpriced` : ""}`);
      void qc.invalidateQueries({ queryKey: ["holdings"] });
      void qc.invalidateQueries({ queryKey: ["performance"] });
      void qc.invalidateQueries({ queryKey: ["dividends"] });
      void qc.invalidateQueries({ queryKey: ["goals"] });
      void qc.invalidateQueries({ queryKey: ["market-status"] });
    },
    onError: (e) => setMsg(e instanceof ApiError ? e.message : "Refresh failed"),
  });

  const last = status.data?.lastUpdated;
  const lastLabel = last
    ? new Date(last).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : null;
  return (
    <div className="flex items-center gap-2">
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {msg ?? (lastLabel ? `As of ${lastLabel}` : "No prices yet")}
      </span>
      <Button variant="secondary" className="h-9 px-3 whitespace-nowrap" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
        {refresh.isPending ? "Refreshing…" : "↻ Refresh prices"}
      </Button>
    </div>
  );
}
