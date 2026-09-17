import { useState } from "react";
import { useBenchmark, useBenchmarks, useFilter } from "../lib/hooks.js";
import { Card, Spinner } from "./ui.js";
import { compactMoney, money, pct, signClass } from "../lib/format.js";

function ReturnCell({ label, xirr, sub }: { label: string; xirr: number | null; sub: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono tabular text-2xl ${xirr !== null ? signClass(xirr) : ""}`}>
        {xirr !== null ? pct(xirr) : "—"}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

export function BenchmarkCard() {
  const { portfolioId } = useFilter();
  const { data: benchmarks } = useBenchmarks();
  const [id, setId] = useState("nifty50");
  const { data, isLoading, isError } = useBenchmark(portfolioId, id);

  return (
    <Card className="mt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium text-muted-foreground">Benchmark comparison</h3>
          <p className="text-xs text-muted-foreground">Your very same cashflows, had they gone into an index instead.</p>
        </div>
        <select
          value={id}
          onChange={(e) => setId(e.target.value)}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
        >
          {(benchmarks ?? [{ id: "nifty50", label: "Nifty 50" }]).map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <Spinner />
      ) : isError || !data ? (
        <p className="text-sm text-muted-foreground">Couldn't load the benchmark comparison.</p>
      ) : !data.available || !data.portfolio || !data.index ? (
        <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
          {data.reason ?? "Benchmark comparison isn't available yet."}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4">
            <ReturnCell label="Your portfolio (XIRR)" xirr={data.portfolio.xirr} sub={`worth ${compactMoney(data.portfolio.currentValue)}`} />
            <ReturnCell label={`${data.label} (XIRR)`} xirr={data.index.xirr} sub={`would be ${compactMoney(data.index.currentValue)}`} />
          </div>

          {data.portfolio.xirr !== null && data.index.xirr !== null && (
            <p className="mt-3 border-t pt-3 text-sm">
              {data.portfolio.xirr >= data.index.xirr ? (
                <span>
                  You're <span className="font-medium text-success">ahead of {data.label}</span> by{" "}
                  {pct(data.portfolio.xirr - data.index.xirr)} annualized —{" "}
                  {money(Number(data.portfolio.currentValue) - Number(data.index.currentValue))} more than the index would be worth
                  on the same cashflows.
                </span>
              ) : (
                <span>
                  You're <span className="font-medium text-destructive">behind {data.label}</span> by{" "}
                  {pct(data.index.xirr - data.portfolio.xirr)} annualized —{" "}
                  {money(Number(data.index.currentValue) - Number(data.portfolio.currentValue))} less than the index would be worth
                  on the same cashflows.
                </span>
              )}
            </p>
          )}

          <p className="mt-3 text-xs text-muted-foreground">
            Since {data.from} · index as of {data.asOf}
            {data.index.unmatchedFlows > 0 && ` · ${data.index.unmatchedFlows} early cashflow(s) predate the index data and were skipped`}
          </p>
          {data.currencyNote && <p className="mt-1 text-xs text-warning">{data.currencyNote}</p>}
        </>
      )}
    </Card>
  );
}
