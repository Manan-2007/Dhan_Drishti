import { useState } from "react";
import { useFilter, useTwr } from "../lib/hooks.js";
import { Button, Card, Spinner } from "./ui.js";
import { pct, signClass } from "../lib/format.js";

/**
 * Time-weighted return — the performance of the holdings with contribution timing stripped
 * out (unlike XIRR). It values the portfolio at each buy/sell date from real historical
 * prices, so it's computed on demand (a button) rather than on every page load.
 */
export function TwrCard() {
  const { portfolioId } = useFilter();
  const [run, setRun] = useState(false);
  const { data, isFetching } = useTwr(portfolioId, run);

  return (
    <Card className="mt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium text-muted-foreground">Time-weighted return (TWR)</h3>
          <p className="text-xs text-muted-foreground">Holdings performance with the effect of when you added money removed.</p>
        </div>
        {!run && (
          <Button variant="secondary" className="h-9 px-3" onClick={() => setRun(true)}>
            Calculate
          </Button>
        )}
      </div>

      {run && isFetching ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Valuing your holdings at each buy/sell date…
        </div>
      ) : run && data ? (
        data.available ? (
          <div className="flex flex-wrap items-end gap-8">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Annualized</div>
              <div className={`mt-1 font-mono tabular text-2xl ${signClass(data.annualized ?? 0)}`}>{pct(data.annualized)}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Cumulative</div>
              <div className={`mt-1 font-mono tabular text-lg ${signClass(data.twr ?? 0)}`}>{pct(data.twr)}</div>
            </div>
            <div className="text-xs text-muted-foreground">
              since {data.from} · {data.subPeriods} sub-period{data.subPeriods === 1 ? "" : "s"}
              {data.mode === "cash-inclusive" && <div className="text-success">cash-inclusive · dividends retained</div>}
            </div>
          </div>
        ) : (
          <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">{data.reason}</p>
        )
      ) : (
        <p className="text-sm text-muted-foreground">
          Fetches each holding's historical prices to chain sub-period returns — click Calculate to run it.
        </p>
      )}
    </Card>
  );
}
