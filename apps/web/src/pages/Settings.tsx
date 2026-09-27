import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, RefreshCw, ShieldCheck } from "lucide-react";
import { Panel } from "@/components/kit/Panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/auth/AuthContext";
import { useMarketStatus, useRefreshPrices } from "@/lib/prices";
import { ago } from "@/lib/format";

interface Rate {
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  asOf: string;
}

/** Just what matters: who you are, where prices come from (and what leaves this computer), your data. */
export function Settings() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const status = useMarketStatus();
  const refresh = useRefreshPrices();
  const rates = useQuery({ queryKey: ["exchange-rates"], queryFn: () => api.get<{ rates: Rate[] }>("/api/exchange-rates").then((r) => r.rates) });
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function exportData() {
    setExporting(true);
    try {
      const res = await fetch("/api/account/export", { credentials: "include" });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dhan-drishti-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  async function deleteAccount() {
    setBusy(true);
    try {
      await api.post("/api/account/delete", { password });
      qc.clear();
      await qc.invalidateQueries({ queryKey: ["me"] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't delete");
    } finally {
      setBusy(false);
    }
  }

  const runRefresh = () =>
    toast.promise(
      refresh.mutateAsync().then(async (r) => {
        await api.post("/api/exchange-rates/refresh").catch(() => undefined);
        void rates.refetch();
        return r;
      }),
      { loading: "Refreshing prices and rates…", success: (r) => `Priced ${r.updated} of ${r.requested}`, error: "Couldn't refresh" },
    );

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="font-display text-5xl leading-none tracking-tight">Settings</h1>

      <Panel title="You">
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <Item label="Username">{user?.username}</Item>
          <Item label="Email">{user?.email ?? "—"}</Item>
          <Item label="Everything shown in">{user?.baseCurrency}</Item>
        </dl>
      </Panel>

      <Panel
        title="Prices"
        action={
          <Button variant="outline" size="sm" onClick={runRefresh} disabled={refresh.isPending}>
            <RefreshCw className={refresh.isPending ? "animate-spin" : undefined} /> Refresh now
          </Button>
        }
      >
        <p className="text-sm">
          Last updated <b>{ago(status.data?.lastUpdated)}</b>. They refresh on their own every few hours, along with exchange rates and price history.
        </p>
        {(rates.data?.length ?? 0) > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2 text-sm">
            {rates.data!.map((r) => (
              <li key={`${r.baseCurrency}${r.quoteCurrency}`} className="rounded-full bg-raised px-3 py-1 tabular-nums">
                1 {r.baseCurrency} = {Number(r.rate).toFixed(2)} {r.quoteCurrency} <span className="text-xs text-muted-foreground">· {ago(r.asOf)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-5 rounded-xl bg-raised/50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="size-4 text-gain" /> What leaves this computer
          </p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Only public names and dates, to look up public prices: share tickers (Yahoo Finance), mutual-fund scheme codes (AMFI, mfapi.in), currency pairs (the
            European Central Bank's rates via Frankfurter). Never how many you hold, what you paid, amounts, names or files. Your ledger stays in the database on this
            machine.
          </p>
        </div>
      </Panel>

      <Panel title="Your data">
        <p className="text-sm text-muted-foreground">Download everything as one file any time. To back up fully, copy the server's database file.</p>
        <Button className="mt-3" variant="outline" onClick={exportData} disabled={exporting}>
          <Download /> {exporting ? "Preparing…" : "Download my data"}
        </Button>
      </Panel>

      <Panel title="Delete account" className="border-loss/30">
        <p className="text-sm text-muted-foreground">Deletes your login and everything under it — people, accounts, trades. It can't be undone.</p>
        <Button className="mt-3" variant="destructive" onClick={() => setDeleting(true)}>
          Delete my account…
        </Button>
      </Panel>

      <p className="text-xs text-muted-foreground">
        Charts by{" "}
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">
          TradingView
        </a>{" "}
        Lightweight Charts™ (Apache-2.0). Motion components adapted from React Bits (MIT). Interface built with shadcn/ui (MIT). NSE listing data from NSE's public files.
      </p>

      <Dialog open={deleting} onOpenChange={(o) => { setDeleting(o); if (!o) setPassword(""); }}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (password) void deleteAccount();
            }}
          >
            <DialogHeader>
              <DialogTitle className="font-display text-2xl font-normal">Delete everything?</DialogTitle>
              <DialogDescription>Type your password to confirm. Download your data first if you might want it back.</DialogDescription>
            </DialogHeader>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className="h-10 rounded-xl" aria-label="Password" autoFocus />
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="ghost">
                  Keep my account
                </Button>
              </DialogClose>
              <Button type="submit" variant="destructive" disabled={!password || busy}>
                {busy ? "Deleting…" : "Delete permanently"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-semibold">{children}</dd>
    </div>
  );
}
