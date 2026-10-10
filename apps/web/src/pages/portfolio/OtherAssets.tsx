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
/** Kinds that usually earn a fixed rate to a maturity date: valued from their terms. */
const DEPOSIT_KINDS = new Set(["fd", "bond"]);
const COMPOUNDING: { id: string; label: string }[] = [
  { id: "quarterly", label: "Added every quarter (most bank FDs)" },
  { id: "monthly", label: "Added every month" },
  { id: "half_yearly", label: "Added every six months" },
  { id: "yearly", label: "Added every year" },
  { id: "simple", label: "Simple interest, paid at maturity" },
  { id: "payout", label: "Paid out to me (coupons / payout FD)" },
];

/**
 * The extra details each non‑deposit kind asks for, so the stored value is backed by something real.
 * FDs and bonds have their own dedicated form (valued from their terms); everything else keeps a
 * hand‑entered value plus whatever of these makes it meaningful.
 */
interface KindSpec {
  valueLabel: string; // the "current value" field
  costLabel?: string; // an amount-in / purchase-price field
  rateLabel?: string; // an interest-rate field (kept as information)
  maturityLabel?: string; // a maturity / lock-in date
  startLabel?: string; // a start / purchase date
  measure?: { label: string; unitLabel: string; units: string[] }; // quantity + unit
}
const SPEC: Record<string, KindSpec> = {
  ppf: { valueLabel: "Balance today (₹)", rateLabel: "Interest rate (% a year)", maturityLabel: "Matures / unlocks on", costLabel: "Total put in (₹, optional)", startLabel: "Opened on" },
  epf: { valueLabel: "Balance today (₹)", rateLabel: "Interest rate (% a year)", costLabel: "Total put in (₹, optional)" },
  nps: { valueLabel: "Value today (₹)", costLabel: "Total contributed (₹, optional)", startLabel: "Started on" },
  savings: { valueLabel: "Balance today (₹)", rateLabel: "Interest rate (% a year)" },
  gold: { valueLabel: "Worth today (₹)", costLabel: "You paid (₹, optional)", measure: { label: "Weight (grams)", unitLabel: "Purity", units: ["24K", "22K", "18K", "Other"] } },
  real_estate: { valueLabel: "Worth today (₹)", costLabel: "Purchase price (₹, optional)", startLabel: "Bought on", measure: { label: "Area", unitLabel: "Unit", units: ["sq ft", "sq yd", "sq m", "acre"] } },
  other: { valueLabel: "Worth today (₹)", costLabel: "You put in (₹, optional)" },
};
const DEFAULT_SPEC: KindSpec = { valueLabel: "Worth today (₹)", costLabel: "You put in (₹, optional)" };

/** "10 g · 24K" for gold, "1200 sq ft" for a property — however the quantity + unit was entered. */
function measureText(asset: ManualAsset): string | null {
  if (!asset.quantity || Number(asset.quantity) <= 0) return null;
  const qty = Number(asset.quantity).toLocaleString("en-IN");
  if (asset.assetClass === "gold") return `${qty} g${asset.unit ? ` · ${asset.unit}` : ""}`;
  return `${qty}${asset.unit ? ` ${asset.unit}` : ""}`;
}

/** "1 yr 4 mo", "23 days" — how long until a date. */
function timeLeft(daysLeft: number): string {
  if (daysLeft <= 0) return "matured";
  if (daysLeft < 45) return `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`;
  const months = Math.round(daysLeft / 30.4);
  const y = Math.floor(months / 12);
  const m = months % 12;
  return `${y ? `${y} yr ` : ""}${m ? `${m} mo` : ""}`.trim() + " left";
}

/** Things with no market price — FDs, PPF, gold, property — that still count in net worth. */
export function OtherAssets() {
  const { portfolioId, scope } = useFilter();
  const { data, isLoading } = useManualAssets(scope);
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
  const dep = asset.deposit ?? null;
  const stale = !dep && asset.valueAsOf ? Date.now() - Date.parse(asset.valueAsOf) > STALE_DAYS * 86_400_000 : false;
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
        {dep ? (
          <p className={cn("text-xs", dep.matured || (dep.daysToMaturity ?? 99) <= 30 ? "text-warning" : "text-muted-foreground")}>
            {[
              kind?.label ?? assetClassLabel(asset.assetClass),
              `${Number(dep.interestRate)}% a year`,
              dep.maturityDate ? (dep.matured ? `matured ${dateShort(dep.maturityDate)}` : `matures ${dateShort(dep.maturityDate)} · ${timeLeft(dep.daysToMaturity ?? 0)}`) : "no maturity date",
            ].join(" · ")}
          </p>
        ) : (
          <p className={cn("text-xs", stale ? "text-warning" : "text-muted-foreground")}>
            {stale && <Clock className="mr-1 inline size-3" />}
            {[
              kind?.label ?? assetClassLabel(asset.assetClass),
              asset.region !== "India" && asset.region,
              measureText(asset),
              asset.interestRate && Number(asset.interestRate) > 0 && `${Number(asset.interestRate)}% a year`,
              asset.maturityDate && `matures ${dateShort(asset.maturityDate)}`,
              asset.valueAsOf && (stale ? `value set ${ago(asset.valueAsOf)} — worth updating` : `as of ${dateShort(asset.valueAsOf)}`),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
        {dep?.elapsed !== null && dep?.elapsed !== undefined && (
          <div className="mt-2 h-1.5 max-w-64 overflow-hidden rounded-full bg-raised" title={`${Math.round(dep.elapsed * 100)}% of the term gone`}>
            <div className="h-full rounded-full bg-primary" style={{ width: `${dep.elapsed * 100}%` }} />
          </div>
        )}
      </div>
      <div className="text-right">
        <p className="font-semibold tabular-nums">{money(asset.currentValue, asset.currency)}</p>
        {dep ? (
          <p className="text-xs text-muted-foreground tabular-nums">
            {dep.compounding === "payout" ? `${money(dep.interestSoFar, asset.currency)} paid out so far` : `${signedMoney(dep.interestSoFar, asset.currency, false)} interest so far`}
            {dep.maturityValue && !dep.matured && dep.compounding !== "payout" && <> · {money(dep.maturityValue, asset.currency)} at maturity</>}
          </p>
        ) : (
          gain !== null && <p className={cn("text-xs tabular-nums", gain >= 0 ? "text-gain" : "text-loss")}>{signedMoney(gain, asset.currency, false)} on cost</p>
        )}
      </div>
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty) save.mutate();
        }}
      >
        {!dep && (
          <>
            <Input type="number" min="0" step="any" value={value} onChange={(e) => setValue(e.target.value)} className="h-9 w-32 rounded-full text-right tabular-nums" aria-label={`New value for ${asset.name}`} />
            <Button type="submit" size="sm" disabled={!dirty || save.isPending}>
              Update
            </Button>
          </>
        )}
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
  const [rate, setRate] = useState("");
  const [start, setStart] = useState(new Date().toISOString().slice(0, 10));
  const [maturity, setMaturity] = useState("");
  const [compounding, setCompounding] = useState("quarterly");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("");
  const [since, setSince] = useState(""); // a property's purchase / account open date (kept empty by default)
  const k = KINDS.find((x) => x.id === kind);
  const spec = (kind && SPEC[kind]) || DEFAULT_SPEC;
  // FDs and bonds are valued from their terms when a rate is given; otherwise by hand as before.
  const isDeposit = !!kind && DEPOSIT_KINDS.has(kind);
  const fromTerms = isDeposit && rate.trim() !== "" && cost.trim() !== "";
  const unitValue = unit || spec.measure?.units[0] || "";
  const create = useMutation({
    mutationFn: () =>
      api.post("/api/manual-assets", {
        name: name.trim() || k?.label || "Asset",
        assetClass: kind,
        region: "India",
        currency: "INR",
        ...(fromTerms
          ? { cost: cost.trim(), interestRate: rate.trim(), startDate: start, maturityDate: maturity || null, compounding }
          : {
              currentValue: value.trim(),
              cost: cost.trim() || undefined,
              // The details this kind asks for, sent only when filled.
              ...(spec.rateLabel && rate.trim() ? { interestRate: rate.trim() } : {}),
              ...(spec.startLabel && since ? { startDate: since } : {}),
              ...(spec.maturityLabel && maturity ? { maturityDate: maturity } : {}),
              ...(spec.measure && qty.trim() ? { quantity: qty.trim(), unit: unitValue } : {}),
            }),
        valueAsOf: new Date().toISOString().slice(0, 10),
        portfolioId: owner || defaultPortfolioId || people?.[0]?.id || undefined,
      }),
    onSuccess: () => {
      setName("");
      setValue("");
      setCost("");
      setRate("");
      setMaturity("");
      setQty("");
      setUnit("");
      setSince("");
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
            if (fromTerms || (Number(value) >= 0 && value.trim())) create.mutate();
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
          {isDeposit ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1.5">
                  <span className="text-sm text-muted-foreground">Amount put in (₹)</span>
                  <Input type="number" min="0" step="any" value={cost} onChange={(e) => setCost(e.target.value)} className="h-10 rounded-xl" required />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm text-muted-foreground">Interest rate (% a year)</span>
                  <Input type="number" min="0" max="50" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 7.1" className="h-10 rounded-xl" required />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm text-muted-foreground">Started on</span>
                  <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="h-10 rounded-xl" required />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm text-muted-foreground">Matures on</span>
                  <Input type="date" value={maturity} min={start} onChange={(e) => setMaturity(e.target.value)} className="h-10 rounded-xl" />
                </label>
              </div>
              <label className="block space-y-1.5">
                <span className="text-sm text-muted-foreground">Interest</span>
                <select value={compounding} onChange={(e) => setCompounding(e.target.value)} className="h-10 w-full cursor-pointer rounded-xl border border-input bg-background px-3.5 text-sm">
                  {COMPOUNDING.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-muted-foreground">Its value is worked out every day from these — nothing to update by hand.</p>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1.5">
                  <span className="text-sm text-muted-foreground">{spec.valueLabel}</span>
                  <Input type="number" min="0" step="any" value={value} onChange={(e) => setValue(e.target.value)} className="h-10 rounded-xl" required />
                </label>
                {spec.costLabel && (
                  <label className="block space-y-1.5">
                    <span className="text-sm text-muted-foreground">{spec.costLabel}</span>
                    <Input type="number" min="0" step="any" value={cost} onChange={(e) => setCost(e.target.value)} className="h-10 rounded-xl" />
                  </label>
                )}
              </div>
              {spec.measure && (
                <div className="grid grid-cols-2 gap-3">
                  <label className="block space-y-1.5">
                    <span className="text-sm text-muted-foreground">{spec.measure.label}</span>
                    <Input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} className="h-10 rounded-xl" />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-sm text-muted-foreground">{spec.measure.unitLabel}</span>
                    <select value={unitValue} onChange={(e) => setUnit(e.target.value)} className="h-10 w-full cursor-pointer rounded-xl border border-input bg-background px-3.5 text-sm">
                      {spec.measure.units.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              {(spec.rateLabel || spec.maturityLabel || spec.startLabel) && (
                <div className="grid grid-cols-2 gap-3">
                  {spec.rateLabel && (
                    <label className="block space-y-1.5">
                      <span className="text-sm text-muted-foreground">{spec.rateLabel}</span>
                      <Input type="number" min="0" max="50" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 7.1" className="h-10 rounded-xl" />
                    </label>
                  )}
                  {spec.startLabel && (
                    <label className="block space-y-1.5">
                      <span className="text-sm text-muted-foreground">{spec.startLabel}</span>
                      <Input type="date" value={since} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setSince(e.target.value)} className="h-10 rounded-xl" />
                    </label>
                  )}
                  {spec.maturityLabel && (
                    <label className="block space-y-1.5">
                      <span className="text-sm text-muted-foreground">{spec.maturityLabel}</span>
                      <Input type="date" value={maturity} onChange={(e) => setMaturity(e.target.value)} className="h-10 rounded-xl" />
                    </label>
                  )}
                </div>
              )}
            </>
          )}
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
            <Button type="submit" disabled={create.isPending || (isDeposit ? !(cost.trim() && rate.trim() && start) : !value.trim())}>
              <Plus /> Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
