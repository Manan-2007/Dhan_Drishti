import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Portfolio } from "../lib/api.js";
import { usePortfolios } from "../lib/hooks.js";
import { PageHeader } from "../components/PageHeader.js";
import { Button, Card, Field, Input, Select, Spinner, Badge } from "../components/ui.js";

const KINDS = ["broker", "group", "strategy", "geo", "goal", "family", "custom"];

export function Portfolios() {
  const qc = useQueryClient();
  const { data: portfolios, isLoading } = usePortfolios();
  const [name, setName] = useState("");
  const [kind, setKind] = useState("broker");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.post<{ portfolio: Portfolio }>("/api/portfolios", { name, kind }),
    onSuccess: () => {
      setName("");
      setError(null);
      void qc.invalidateQueries({ queryKey: ["portfolios"] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Failed to create"),
  });

  const del = useMutation({
    mutationFn: (id: string) => api.del(`/api/portfolios/${id}`),
    onSuccess: () => void qc.invalidateQueries(),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim()) create.mutate();
  }

  return (
    <>
      <PageHeader title="Portfolios" showFilter={false} />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          {isLoading ? (
            <Spinner />
          ) : portfolios && portfolios.length > 0 ? (
            portfolios.map((p) => (
              <Card key={p.id} className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 font-medium">
                    {p.name} <Badge tone="muted">{p.kind}</Badge>
                  </div>
                  {p.description && <p className="text-sm text-muted-foreground">{p.description}</p>}
                  <p className="text-xs text-muted-foreground">Base {p.baseCurrency}</p>
                </div>
                <Button
                  variant="ghost"
                  className="h-8 px-2 text-destructive"
                  onClick={() => {
                    if (confirm(`Delete portfolio "${p.name}" and all its transactions?`)) del.mutate(p.id);
                  }}
                >
                  Delete
                </Button>
              </Card>
            ))
          ) : (
            <Card className="text-sm text-muted-foreground">No portfolios yet. Create your first one →</Card>
          )}
        </div>

        <Card className="h-fit">
          <h3 className="mb-3 font-serif text-lg">New portfolio</h3>
          <form onSubmit={submit} className="space-y-3">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Zerodha, Long Term…" required />
            </Field>
            <Field label="Kind">
              <Select value={kind} onChange={(e) => setKind(e.target.value)}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </Select>
            </Field>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create portfolio"}
            </Button>
          </form>
        </Card>
      </div>
    </>
  );
}
