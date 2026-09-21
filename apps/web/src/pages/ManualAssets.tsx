import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type ManualAsset } from "../lib/api.js";
import { useFilter, useManualAssets, usePortfolios } from "../lib/hooks.js";
import { PageHeader } from "../components/PageHeader.js";
import { Button, Card, EmptyState, Field, Input, Select, Spinner, Badge } from "../components/ui.js";
import { money, compactMoney, signClass, dateShort, assetClassLabel } from "../lib/format.js";

const CLASSES = ["fd", "ppf", "epf", "nps", "savings", "gold", "real_estate", "bond", "other"];
const REGIONS = ["India", "United States", "United Kingdom", "Europe", "Singapore", "UAE", "Other"];

function AssetCard({ asset, onSave, onDelete, busy }: { asset: ManualAsset; onSave: (id: string, value: string) => void; onDelete: (id: string) => void; busy: boolean }) {
  const [value, setValue] = useState(asset.currentValue);
  const dirty = value.trim() !== asset.currentValue && Number(value) >= 0 && value.trim() !== "";
  const gain = asset.gain !== null ? Number(asset.gain) : null;
  return (
    <Card>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-serif text-lg">{asset.name}</h3>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge tone="muted">{assetClassLabel(asset.assetClass)}</Badge>
            <span>{asset.region}</span>
            {asset.currency !== "INR" && <span>{asset.currency}</span>}
            {asset.valueAsOf && <span>· as of {dateShort(asset.valueAsOf)}</span>}
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono tabular text-xl">{money(asset.currentValue, asset.currency)}</div>
          {gain !== null && (
            <div className={`text-xs font-mono tabular ${signClass(gain)}`}>
              {gain >= 0 ? "+" : ""}
              {money(gain, asset.currency)} vs cost
            </div>
          )}
        </div>
      </div>
      {asset.notes && <p className="mb-2 text-sm text-muted-foreground">{asset.notes}</p>}
      <div className="mt-3 flex items-center gap-2 border-t pt-3">
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">Update value</span>
          <Input type="number" min="0" step="any" value={value} onChange={(e) => setValue(e.target.value)} className="h-9 w-32 font-mono tabular" />
        </div>
        <Button className="h-9 px-3" disabled={!dirty || busy} onClick={() => onSave(asset.id, value.trim())}>
          Save
        </Button>
        <Button variant="ghost" className="ml-auto h-9 px-2 text-destructive" onClick={() => onDelete(asset.id)}>
          Delete
        </Button>
      </div>
    </Card>
  );
}

export function ManualAssets() {
  const qc = useQueryClient();
  const { portfolioId } = useFilter();
  const { data, isLoading } = useManualAssets(portfolioId);
  const { data: portfolios } = usePortfolios();

  const [name, setName] = useState("");
  const [assetClass, setAssetClass] = useState("fd");
  const [region, setRegion] = useState("India");
  const [currency, setCurrency] = useState("INR");
  const [currentValue, setCurrentValue] = useState("");
  const [cost, setCost] = useState("");
  const [notes, setNotes] = useState("");
  const [pid, setPid] = useState("");
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["manual-assets"] });
    void qc.invalidateQueries({ queryKey: ["holdings"] });
    void qc.invalidateQueries({ queryKey: ["networth"] });
  };

  const create = useMutation({
    mutationFn: () =>
      api.post("/api/manual-assets", {
        name,
        assetClass,
        region,
        currency,
        currentValue,
        cost: cost.trim() ? cost.trim() : undefined,
        notes: notes.trim() ? notes.trim() : undefined,
        portfolioId: pid || undefined,
      }),
    onSuccess: () => {
      setName("");
      setCurrentValue("");
      setCost("");
      setNotes("");
      setError(null);
      invalidate();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Failed to add asset"),
  });

  const update = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) => api.put(`/api/manual-assets/${id}`, { currentValue: value }),
    onSuccess: invalidate,
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/api/manual-assets/${id}`),
    onSuccess: invalidate,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim() && Number(currentValue) >= 0 && currentValue.trim() !== "") create.mutate();
  }

  return (
    <>
      <PageHeader
        title="Manual assets"
        subtitle={data && data.count > 0 ? `${data.count} asset${data.count === 1 ? "" : "s"} · ${compactMoney(data.total)} in net worth` : "FDs, PPF, EPF, gold, real estate & more"}
      />

      {data && !data.fxComplete && (
        <Card className="mb-4 border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
          Some assets are in {data.unconvertibleCurrencies.join(", ")} with no exchange rate yet, so they're excluded from the
          {" "}{data.baseCurrency} total. Set a rate in Settings.
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-3">
          {isLoading ? (
            <Spinner />
          ) : data && data.items.length > 0 ? (
            data.items.map((a) => (
              <AssetCard
                key={a.id}
                asset={a}
                busy={update.isPending || del.isPending}
                onSave={(id, value) => update.mutate({ id, value })}
                onDelete={(id) => del.mutate(id)}
              />
            ))
          ) : (
            <EmptyState title="No manual assets yet">
              Add anything that isn't in a broker account — a fixed deposit, PPF/EPF, physical gold, real estate, or a savings
              balance. You maintain the value; it folds straight into your net worth and allocation.
            </EmptyState>
          )}
        </div>

        <Card className="h-fit">
          <h3 className="mb-3 font-serif text-lg">Add asset</h3>
          <form onSubmit={submit} className="space-y-3">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="SBI FD 2027, Apartment…" required />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <Select value={assetClass} onChange={(e) => setAssetClass(e.target.value)}>
                  {CLASSES.map((c) => (
                    <option key={c} value={c}>
                      {assetClassLabel(c)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Region">
                <Select value={region} onChange={(e) => setRegion(e.target.value)}>
                  {REGIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Current value">
                <Input type="number" min="0" step="any" value={currentValue} onChange={(e) => setCurrentValue(e.target.value)} required />
              </Field>
              <Field label="Cost (optional)">
                <Input type="number" min="0" step="any" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="—" />
              </Field>
            </div>
            <Field label="Currency">
              <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} />
            </Field>
            {portfolios && portfolios.length > 0 && (
              <Field label="Portfolio (optional)">
                <Select value={pid} onChange={(e) => setPid(e.target.value)}>
                  <option value="">Unassigned (counts in All portfolios)</option>
                  {portfolios.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Notes (optional)">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Maturity, rate, location…" />
            </Field>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={create.isPending}>
              {create.isPending ? "Adding…" : "Add asset"}
            </Button>
          </form>
          <p className="mt-3 text-xs text-muted-foreground">You maintain these values by hand — update them whenever they change.</p>
        </Card>
      </div>
    </>
  );
}
