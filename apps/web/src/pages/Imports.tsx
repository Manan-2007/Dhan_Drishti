import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type ImportPreview, type ImportResult } from "../lib/api.js";
import { usePortfolios, useImports } from "../lib/hooks.js";
import { PageHeader } from "../components/PageHeader.js";
import { ClassifyCard } from "../components/ClassifyCard.js";
import { Button, Card, Field, Input, Select, Spinner, Badge } from "../components/ui.js";
import { dateShort } from "../lib/format.js";

type Step = "select" | "preview" | "done";

function CountTile({ label, value, tone }: { label: string; value: number; tone?: "success" | "danger" | "warning" | "muted" }) {
  const color = { success: "text-success", danger: "text-destructive", warning: "text-warning", muted: "text-foreground" }[tone ?? "muted"];
  return (
    <div className="rounded-md border bg-background p-3 text-center">
      <div className={`font-mono tabular text-xl ${color}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

export function Imports() {
  const qc = useQueryClient();
  const { data: portfolios } = usePortfolios();
  const { data: history } = useImports();
  const { data: brokers } = useQuery({
    queryKey: ["brokers"],
    queryFn: () => api.get<{ brokers: { id: string; label: string }[] }>("/api/imports/brokers").then((r) => r.brokers),
  });

  const [portfolioId, setPortfolioId] = useState("");
  const [broker, setBroker] = useState("zerodha");
  const [filename, setFilename] = useState("");
  const [content, setContent] = useState("");
  // Generic column mapping (only used when broker === "generic").
  const [map, setMap] = useState<Record<string, string>>({});
  const [buyVals, setBuyVals] = useState("buy");
  const [sellVals, setSellVals] = useState("sell");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [replace, setReplace] = useState(false);
  const [step, setStep] = useState<Step>("select");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!portfolioId && portfolios && portfolios.length > 0) setPortfolioId(portfolios[0]!.id);
  }, [portfolios, portfolioId]);

  function reset() {
    setStep("select");
    setPreview(null);
    setResult(null);
    setContent("");
    setFilename("");
    setError(null);
  }

  async function onFile(file: File) {
    setFilename(file.name);
    setContent(await file.text());
  }

  const headers = content ? (content.split(/\r?\n/)[0] ?? "").split(",").map((h) => h.trim()).filter(Boolean) : [];
  const isGeneric = broker === "generic";
  const REQUIRED_MAP = ["symbol", "date", "type", "quantity", "price"] as const;
  const mappingComplete = REQUIRED_MAP.every((f) => map[f]);

  function buildPayload() {
    const period = from && to ? { from, to, replace } : {};
    const base = { portfolioId, broker, filename: filename || "upload.csv", content, ...period };
    if (!isGeneric) return base;
    return {
      ...base,
      mapping: {
        symbol: map.symbol,
        date: map.date,
        type: map.type,
        quantity: map.quantity,
        price: map.price,
        name: map.name || undefined,
        isin: map.isin || undefined,
        amount: map.amount || undefined,
        fees: map.fees || undefined,
        buyValues: buyVals.split(",").map((s) => s.trim()).filter(Boolean),
        sellValues: sellVals.split(",").map((s) => s.trim()).filter(Boolean),
      },
    };
  }

  async function runCheck() {
    setError(null);
    setBusy(true);
    try {
      const p = await api.post<ImportPreview>("/api/imports/check", buildPayload());
      setPreview(p);
      setStep("preview");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  }

  async function runCommit() {
    setError(null);
    setBusy(true);
    try {
      const r = await api.post<ImportResult>("/api/imports/commit", buildPayload());
      setResult(r);
      setStep("done");
      void qc.invalidateQueries();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  const noPortfolios = portfolios && portfolios.length === 0;

  return (
    <>
      <PageHeader title="Import" subtitle="Bring transactions in from a broker CSV" showFilter={false} />

      {noPortfolios ? (
        <Card className="text-sm text-muted-foreground">Create a portfolio first, then import into it.</Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <Card>
            {/* Stepper */}
            <div className="mb-4 flex items-center gap-2 text-xs">
              {(["select", "preview", "done"] as Step[]).map((s, i) => (
                <div key={s} className="flex items-center gap-2">
                  <span className={`grid h-6 w-6 place-items-center rounded-full ${step === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{i + 1}</span>
                  <span className={step === s ? "font-medium" : "text-muted-foreground"}>
                    {s === "select" ? "Choose & upload" : s === "preview" ? "Preview" : "Done"}
                  </span>
                  {i < 2 && <span className="text-muted-foreground">→</span>}
                </div>
              ))}
            </div>

            {step === "select" && (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Portfolio">
                    <Select value={portfolioId} onChange={(e) => setPortfolioId(e.target.value)}>
                      {portfolios?.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="What are you uploading?">
                    <Select value={broker} onChange={(e) => setBroker(e.target.value)}>
                      {brokers?.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <p className="-mt-2 text-xs text-muted-foreground">
                  Import each broker export separately — trades (tradebook / transaction report), funds (deposits &
                  withdrawals) and dividends. Holdings snapshots are supported too.
                </p>

                <div className="rounded-md border bg-background p-3">
                  <p className="mb-2 text-sm font-medium">Period covered <span className="font-normal text-muted-foreground">(optional)</span></p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
                    <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
                  </div>
                  <label className="mt-3 flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-1" checked={replace} disabled={!from || !to} onChange={(e) => setReplace(e.target.checked)} />
                    <span>
                      Replace existing data from this source in this period.
                      <span className="block text-xs text-muted-foreground">Re-uploading a wider range (e.g. a full year over monthly files) overwrites cleanly — no duplicates.</span>
                    </span>
                  </label>
                </div>

                <Field label="CSV file">
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])}
                    className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:bg-card file:px-3 file:py-2 file:text-sm"
                  />
                </Field>
                {filename && <p className="text-xs text-muted-foreground">Loaded {filename} ({content.length.toLocaleString()} chars)</p>}

                {isGeneric && content && (
                  <div className="rounded-md border bg-background p-3">
                    <p className="mb-2 text-sm font-medium">Map your columns</p>
                    <p className="mb-3 text-xs text-muted-foreground">Tell Dhan Drishti which column is which. Required: symbol, date, type, quantity, price.</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {([
                        ["symbol", "Symbol *"],
                        ["date", "Trade date *"],
                        ["type", "Buy/sell column *"],
                        ["quantity", "Quantity *"],
                        ["price", "Price *"],
                        ["name", "Name (optional)"],
                        ["amount", "Amount (optional)"],
                        ["fees", "Fees (optional)"],
                      ] as const).map(([field, label]) => (
                        <label key={field} className="text-xs">
                          <span className="mb-1 block text-muted-foreground">{label}</span>
                          <Select className="h-9" value={map[field] ?? ""} onChange={(e) => setMap((m) => ({ ...m, [field]: e.target.value }))}>
                            <option value="">—</option>
                            {headers.map((h) => (
                              <option key={h} value={h}>
                                {h}
                              </option>
                            ))}
                          </Select>
                        </label>
                      ))}
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <label className="text-xs">
                        <span className="mb-1 block text-muted-foreground">Buy values (comma-separated)</span>
                        <Input className="h-9" value={buyVals} onChange={(e) => setBuyVals(e.target.value)} />
                      </label>
                      <label className="text-xs">
                        <span className="mb-1 block text-muted-foreground">Sell values (comma-separated)</span>
                        <Input className="h-9" value={sellVals} onChange={(e) => setSellVals(e.target.value)} />
                      </label>
                    </div>
                  </div>
                )}

                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button onClick={runCheck} disabled={!content || !portfolioId || busy || (isGeneric && !mappingComplete)}>
                  {busy ? "Checking…" : "Preview import"}
                </Button>
              </div>
            )}

            {step === "preview" && preview && (
              <div className="space-y-4">
                {preview.detected && (
                  <p className="text-sm text-muted-foreground">
                    Detected <Badge tone="muted">{preview.detected.broker}</Badge> — {preview.detected.reason}
                  </p>
                )}
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  <CountTile label="Rows" value={preview.rowsTotal} />
                  <CountTile label="To import" value={preview.toImport} tone="success" />
                  <CountTile label="Duplicates" value={preview.duplicates} tone="warning" />
                  <CountTile label="Invalid" value={preview.invalid} tone={preview.invalid ? "danger" : "muted"} />
                  <CountTile label="New securities" value={preview.newSecurities} />
                </div>

                {preview.newSecuritySymbols.length > 0 && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">New securities will be added: </span>
                    {preview.newSecuritySymbols.slice(0, 20).join(", ")}
                    {preview.newSecuritySymbols.length > 20 && ` +${preview.newSecuritySymbols.length - 20} more`}
                  </div>
                )}

                {preview.invalidRows.length > 0 && (
                  <div>
                    <p className="mb-1 text-sm font-medium text-destructive">Rows that will be skipped:</p>
                    <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                      {preview.invalidRows.map((r) => (
                        <li key={r.rowIndex}>Row {r.rowIndex + 2}: {r.error}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {error && <p className="text-sm text-destructive">{error}</p>}
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={reset}>
                    Back
                  </Button>
                  <Button onClick={runCommit} disabled={busy || preview.toImport === 0}>
                    {busy ? "Importing…" : `Confirm import (${preview.toImport})`}
                  </Button>
                </div>
              </div>
            )}

            {step === "done" && result && (
              <div className="space-y-4 text-center">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-success/15 text-success">✓</div>
                <div>
                  <h3 className="font-serif text-lg">Import complete</h3>
                  <p className="text-sm text-muted-foreground">
                    Imported <span className="font-medium text-foreground">{result.imported}</span> transactions
                    {result.replaced > 0 && ` · replaced ${result.replaced} in range`}
                    {result.duplicates > 0 && ` · skipped ${result.duplicates} duplicates`}
                    {result.invalid > 0 && ` · ${result.invalid} invalid`}
                    {result.newSecurities > 0 && ` · ${result.newSecurities} new securities`}.
                  </p>
                </div>
                <Button onClick={reset}>Import another file</Button>
              </div>
            )}
          </Card>

          <div className="space-y-4">
          <ClassifyCard />
          <Card className="h-fit">
            <h3 className="mb-3 text-sm font-medium text-muted-foreground">Import history</h3>
            {history && history.length > 0 ? (
              <ul className="space-y-2 text-sm">
                {history.map((b) => (
                  <li key={b.id} className="border-b pb-2 last:border-0">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{b.filename}</span>
                      <Badge tone="muted">{b.broker}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {dateShort(b.createdAt)} · {b.rowsImported} imported
                      {b.rowsSkipped ? `, ${b.rowsSkipped} skipped` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No imports yet.</p>
            )}
          </Card>
          </div>
        </div>
      )}
    </>
  );
}
