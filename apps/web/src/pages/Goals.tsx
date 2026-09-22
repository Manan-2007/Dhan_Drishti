import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api.js";
import { useGoals, usePortfolios, type Goal } from "../lib/hooks.js";
import { useToast } from "../components/Toast.js";
import { PageHeader } from "../components/PageHeader.js";
import { Button, Card, EmptyState, Field, Input, Spinner, Badge } from "../components/ui.js";
import { money, compactMoney, pct, dateShort } from "../lib/format.js";

function GoalCard({ goal, onDelete }: { goal: Goal; onDelete: (goal: Goal) => void }) {
  const progress = Math.min(1, Math.max(0, Number(goal.progress ?? 0)));
  return (
    <Card>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h3 className="font-serif text-lg">{goal.name}</h3>
          <p className="text-xs text-muted-foreground">
            Target {money(goal.targetAmount, goal.currency)}
            {goal.targetDate ? ` · by ${dateShort(goal.targetDate)}` : ""}
          </p>
        </div>
        {goal.reached ? <Badge tone="success">Reached 🎉</Badge> : <Badge tone="muted">{pct(goal.progress)}</Badge>}
      </div>

      <div className="mb-1 h-2.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${goal.reached ? "bg-success" : "bg-primary"}`}
          style={{ width: `${(progress * 100).toFixed(1)}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{compactMoney(goal.funded)} funded</span>
        <span>{compactMoney(goal.remaining)} to go</span>
      </div>

      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {goal.basis === "current_value" ? "by market value" : "by invested"}
          {goal.requiredMonthly && goal.monthsRemaining
            ? ` · ${money(goal.requiredMonthly, goal.currency)}/mo for ${goal.monthsRemaining} mo`
            : ""}
        </span>
        <Button variant="ghost" className="h-7 px-2 text-destructive" onClick={() => onDelete(goal)}>
          Delete
        </Button>
      </div>
    </Card>
  );
}

export function Goals() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const { data: goals, isLoading } = useGoals();
  const { data: portfolios } = usePortfolios();
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [date, setDate] = useState("");
  const [pids, setPids] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.post("/api/goals", {
        name,
        targetAmount: target,
        targetDate: date || undefined,
        portfolioIds: pids.length ? pids : undefined,
      }),
    onSuccess: () => {
      setName("");
      setTarget("");
      setDate("");
      setPids([]);
      setError(null);
      void qc.invalidateQueries({ queryKey: ["goals"] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Failed to create goal"),
  });

  const del = useMutation({
    mutationFn: (id: string) => api.del(`/api/goals/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["goals"] }),
  });
  const recreate = useMutation({
    mutationFn: (g: Goal) =>
      api.post("/api/goals", { name: g.name, targetAmount: g.targetAmount, targetDate: g.targetDate ?? undefined, currency: g.currency, portfolioIds: g.portfolioIds.length ? g.portfolioIds : undefined }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["goals"] }),
  });
  const handleDelete = (g: Goal) => {
    del.mutate(g.id);
    showToast(`Deleted “${g.name}”`, { label: "Undo", onClick: () => recreate.mutate(g) });
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim() && Number(target) > 0) create.mutate();
  }

  return (
    <>
      <PageHeader title="Goals" showFilter={false} />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          {isLoading ? (
            <Spinner />
          ) : goals && goals.length > 0 ? (
            goals.map((g) => <GoalCard key={g.id} goal={g} onDelete={handleDelete} />)
          ) : (
            <EmptyState title="No goals yet">
              Set a target amount (and optionally a date). Progress is measured from the current value of the
              portfolios you link — real data, never a projection.
            </EmptyState>
          )}
        </div>

        <Card className="h-fit">
          <h3 className="mb-3 font-serif text-lg">New goal</h3>
          <form onSubmit={submit} className="space-y-3">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Retirement, House…" required />
            </Field>
            <Field label="Target amount (₹)">
              <Input type="number" min="1" step="any" value={target} onChange={(e) => setTarget(e.target.value)} required />
            </Field>
            <Field label="Target date (optional)">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <div>
              <span className="mb-1 block text-sm font-medium text-muted-foreground">Funded by</span>
              <p className="mb-2 text-xs text-muted-foreground">Leave empty to use all portfolios.</p>
              <div className="space-y-1">
                {portfolios?.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={pids.includes(p.id)}
                      onChange={(e) => setPids((cur) => (e.target.checked ? [...cur, p.id] : cur.filter((x) => x !== p.id)))}
                    />
                    {p.name}
                  </label>
                ))}
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create goal"}
            </Button>
          </form>
        </Card>
      </div>
    </>
  );
}
