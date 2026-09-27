import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, Clock, Coins, Gem, Landmark, PiggyBank, Plus, ScrollText, Shield, Trash2, Wallet } from "lucide-react";
import { Stat } from "@/components/kit/Stat";
import { ScopeSelect } from "@/components/shell/ScopeSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, ApiError, type ManualAsset } from "@/lib/api";
import { useFilter, useManualAssets, usePortfolios } from "@/lib/hooks";
import { ago, assetClassLabel, compactMoney, dateShort, money, signedMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

const KINDS: { id: string; label: string; icon: ReactNode; hint: string }[] = [
  { id: "fd", label: "Fixed deposit", icon: <Landmark />, hint: "Bank or company FD" },
  { id: "ppf", label: "PPF", icon: <Shield />, hint: "Public Provident Fund" },
  { id: "epf", label: "EPF", icon: <PiggyBank />, hint: "Provident fund at work" },
  { id: "nps", label: "NPS", icon: <ScrollText />, hint: "National Pension System" },
  { id: "savings", label: "Savings", icon: <Wallet />, hint: "Bank balance" },
  { id: "gold", label: "Gold", icon: <Gem />, hint: "Jewellery, coins, bars" },
  { id: "real_estate", label: "Property", icon: <Building2 />, hint: "House, flat, land" },
  { id: "bond", label: "Bonds", icon: <ScrollText />, hint: "Bonds, NCDs" },
  { id: "other", label: "Other", icon: <Coins />, hint: "Anything else" },
];
const STALE_DAYS = 90;

/** Things with no market price — FDs, PPF, gold, property — that still count in net worth. */
export function OtherAssets() {
  const { portfolioId } = useFilter();
  const { data, isLoading } = useManualAssets(portfolioId);
  const [adding, setAdding] = useState<string | null>(null);

  if (isLoading) return <Skeleton className="h-72 rounded-2xl" />;
  const ccy = data?.baseCurrency ?? "INR";
  const items = data?.items ?? [];
  const gain = data ? Number(data.total) - Number(data.totalCost) : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">FDs, PPF, gold, property — anything without a market price. You set the value; it counts in your net worth.</p>
        <ScopeSelect />
      </div>

      {items.length > 0 && data && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Stat label="Worth" value={compactMoney(data.total, ccy)} title={money(data.total, ccy)} sub={`${data.count} item${data.count === 1 ? "" : "s"}`} />
          <Stat label="Put in" value={Number(data.totalCost) ? compactMoney(data.totalCost, ccy) : "—"} sub="where you entered a cost" />
          {Number(data.totalCost) > 0 && <Stat label="Gain" value={signedMoney(gain, ccy)} tone={gain >= 0 ? "gain" : "loss"} />}
        </div>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">Add</h2>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => setAdding(k.id)}
              title={k.hint}
              className="group flex cursor-pointer flex-col items-center gap-2 rounded-2xl border bg-card px-2 py-4 text-sm transition-colors hover:border-primary/60 hover:bg-raised active:scale-[0.97]"
            >
              <span className="text-muted-foreground transition-colors group-hover:text-primary [&_svg]:size-5">{k.icon}</span>
              {k.label}
            </button>
          ))}
        </div>
      </section>

      {items.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Yours</h2>
          {items.map((a) => (
            <AssetRow key={a.id} asset={a} />
          ))}
        </section>
      )}

      <AddDialog kind={adding} onClose={() => setAdding(null)} defaultPortfolioId={portfolioId} />
    </div>
  );
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["manual-assets"] });
    void qc.invalidateQueries({ queryKey: ["holdings"] });
    void qc.invalidateQueries({ queryKey: ["networth"] });
  };
}

function AssetRow({ asset }: { asset: ManualAsset }) {
  const invalidate = useInvalidate();
  const [value, setValue] = useState(asset.currentValue);
  const [confirming, setConfirming] = useState(false);
  const kind = KINDS.find((k) => k.id === asset.assetClass);
  const stale = asset.valueAsOf ? Date.now() - Date.parse(asset.valueAsOf) > STALE_DAYS * 86_400_000 : false;
  const dirty = value.trim() !== asset.currentValue && value.trim() !== "" && Number(value) >= 0;
  const save = useMutation({
    mutationFn: () => api.put(`/api/manual-assets/${asset.id}`, { currentValue: value.trim(), valueAsOf: new Date().toISOString().slice(0, 10) }),
    onSuccess: () => {
      invalidate();
      toast.success("Value updated");
    },
    onError: () => toast.error("Couldn't save"),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/api/manual-assets/${asset.id}`),
    onSuccess: () => {
      setConfirming(false);
      invalidate();
    },
  });
  const gain = asset.gain !== null ? Number(asset.gain) : null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border bg-card px-4 py-3.5">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-raised text-muted-foreground [&_svg]:size-5">{kind?.icon ?? <Coins />}</span>
      <div className="min-w-40 flex-1">
        <p className="font-semibold">{asset.name}</p>
        <p className={cn("text-xs", stale ? "text-warning" : "text-muted-foreground")}>
          {stale && <Clock className="mr-1 inline size-3" />}
          {[kind?.label ?? assetClassLabel(asset.assetClass), asset.region !== "India" && asset.region, asset.valueAsOf && (stale ? `value set ${ago(asset.valueAsOf)} — worth updating` : `as of ${dateShort(asset.valueAsOf)}`)].filter(Boolean).join(" · ")}
        </p>
      </div>
      <div className="text-right">
        <p className="font-semibold tabular-nums">{money(asset.currentValue, asset.currency)}</p>
        {gain !== null && <p className={cn("text-xs tabular-nums", gain >= 0 ? "text-gain" : "text-loss")}>{signedMoney(gain, asset.currency, false)} on cost</p>}
      </div>
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty) save.mutate();
        }}
      >
        <Input type="number" min="0" step="any" value={value} onChange={(e) => setValue(e.target.value)} className="h-9 w-32 rounded-full text-right tabular-nums" aria-label={`New value for ${asset.name}`} />
        <Button type="submit" size="sm" disabled={!dirty || save.isPending}>
          Update
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" className="text-loss hover:text-loss" onClick={() => setConfirming(true)} aria-label={`Remove ${asset.name}`}>
          <Trash2 />
        </Button>
      </form>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="rounded-2xl sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-normal">Remove {asset.name}?</DialogTitle>
            <DialogDescription>It stops counting in your net worth.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Keep it</Button>
            </DialogClose>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AddDialog({ kind, onClose, defaultPortfolioId }: { kind: string | null; onClose: () => void; defaultPortfolioId: string | null }) {
  const invalidate = useInvalidate();
  const { data: people } = usePortfolios();
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [cost, setCost] = useState("");
  const [owner, setOwner] = useState("");
  const k = KINDS.find((x) => x.id === kind);
  const create = useMutation({
    mutationFn: () =>
      api.post("/api/manual-assets", {
        name: name.trim() || k?.label || "Asset",
        assetClass: kind,
        region: "India",
        currency: "INR",
        currentValue: value.trim(),
        cost: cost.trim() || undefined,
        valueAsOf: new Date().toISOString().slice(0, 10),
        portfolioId: owner || defaultPortfolioId || people?.[0]?.id || undefined,
      }),
    onSuccess: () => {
      setName("");
      setValue("");
      setCost("");
      invalidate();
      onClose();
      toast.success("Added to your net worth");
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't add"),
  });
  return (
    <Dialog open={!!kind} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-2xl sm:max-w-md">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (Number(value) >= 0 && value.trim()) create.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-normal">Add {k?.label.toLowerCase()}</DialogTitle>
            <DialogDescription>{k?.hint}. You can update the value any time.</DialogDescription>
          </DialogHeader>
          <label className="block space-y-1.5">
            <span className="text-sm text-muted-foreground">Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "fd" ? "e.g. SBI FD, 7.1%" : kind === "real_estate" ? "e.g. Flat in Pune" : k?.label} className="h-10 rounded-xl" autoFocus />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1.5">
              <span className="text-sm text-muted-foreground">Worth today (₹)</span>
              <Input type="number" min="0" step="any" value={value} onChange={(e) => setValue(e.target.value)} className="h-10 rounded-xl" required />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm text-muted-foreground">You put in (₹, optional)</span>
              <Input type="number" min="0" step="any" value={cost} onChange={(e) => setCost(e.target.value)} className="h-10 rounded-xl" />
            </label>
          </div>
          {people && people.length > 1 && (
            <label className="block space-y-1.5">
              <span className="text-sm text-muted-foreground">Whose</span>
              <select value={owner || defaultPortfolioId || people[0]!.id} onChange={(e) => setOwner(e.target.value)} className="h-10 w-full cursor-pointer rounded-xl border border-input bg-background px-3.5 text-sm">
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={create.isPending || !value.trim()}>
              <Plus /> Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
