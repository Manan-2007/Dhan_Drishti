import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Portfolio } from "../lib/api.js";
import { Button, Card, Input, Select } from "./ui.js";

const BROKERS: { id: string; label: string }[] = [
  { id: "zerodha", label: "Zerodha" },
  { id: "dhan", label: "Dhan" },
  { id: "vested", label: "Vested (US)" },
  { id: "ibkr", label: "Interactive Brokers" },
  { id: "binance", label: "Binance (crypto)" },
  { id: "other", label: "Other" },
];

interface Member {
  name: string;
  brokers: string[];
}

/** First-run setup: choose personal or family, then create member portfolios and their brokers. */
export function Onboarding() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"choose" | "personal" | "family">("choose");
  const [personalName, setPersonalName] = useState("My Portfolio");
  const [personalBroker, setPersonalBroker] = useState("");
  const [members, setMembers] = useState<Member[]>([{ name: "", brokers: [] }]);
  const [error, setError] = useState<string | null>(null);

  const done = () => qc.invalidateQueries();

  const createPersonal = useMutation({
    mutationFn: async () => {
      const { portfolio } = await api.post<{ portfolio: Portfolio }>("/api/portfolios", { name: personalName.trim() || "My Portfolio", kind: "custom" });
      // Tie the portfolio to a broker (as an account) so imports offer only that broker's files.
      if (personalBroker) {
        const label = BROKERS.find((b) => b.id === personalBroker)?.label ?? personalBroker;
        await api.post("/api/accounts", { portfolioId: portfolio.id, name: label, broker: personalBroker });
      }
    },
    onSuccess: done,
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not create"),
  });

  const createFamily = useMutation({
    mutationFn: async () => {
      const valid = members.filter((m) => m.name.trim());
      if (valid.length === 0) throw new ApiError(400, "no_members", "Add at least one member");
      for (const m of valid) {
        const { portfolio } = await api.post<{ portfolio: { id: string } }>("/api/portfolios", { name: m.name.trim(), kind: "family" });
        for (const b of m.brokers) {
          await api.post("/api/accounts", { portfolioId: portfolio.id, name: `${m.name.trim()} · ${BROKERS.find((x) => x.id === b)?.label ?? b}`, broker: b === "other" ? "manual" : b });
        }
      }
    },
    onSuccess: done,
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not create"),
  });

  const setMember = (i: number, patch: Partial<Member>) => setMembers((ms) => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const toggleBroker = (i: number, b: string) =>
    setMembers((ms) => ms.map((m, j) => (j === i ? { ...m, brokers: m.brokers.includes(b) ? m.brokers.filter((x) => x !== b) : [...m.brokers, b] } : m)));

  if (mode === "choose") {
    return (
      <Card className="mx-auto max-w-2xl p-8 text-center">
        <h2 className="font-serif text-2xl">Welcome to Dhan Drishti</h2>
        <p className="mx-auto mt-2 max-w-md text-muted-foreground">How would you like to organize your investments?</p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <button onClick={() => setMode("personal")} className="rounded-xl border bg-card p-6 text-left transition-colors hover:border-foreground/25">
            <div className="text-lg font-medium">Personal use</div>
            <p className="mt-1 text-sm text-muted-foreground">One portfolio for your own holdings across brokers.</p>
          </button>
          <button onClick={() => setMode("family")} className="rounded-xl border bg-card p-6 text-left transition-colors hover:border-foreground/25">
            <div className="text-lg font-medium">Managing family</div>
            <p className="mt-1 text-sm text-muted-foreground">A portfolio per member (e.g. Hanu, Manan) — see each and the whole family together.</p>
          </button>
        </div>
      </Card>
    );
  }

  if (mode === "personal") {
    return (
      <Card className="mx-auto max-w-lg p-8">
        <button onClick={() => setMode("choose")} className="mb-4 text-sm text-muted-foreground hover:text-foreground">← Back</button>
        <h2 className="font-serif text-xl">Name your portfolio</h2>
        <div className="mt-4 space-y-1.5">
          <Input value={personalName} onChange={(e) => setPersonalName(e.target.value)} placeholder="My Portfolio" />
        </div>
        <div className="mt-4 space-y-1.5">
          <label className="text-sm text-muted-foreground">Broker</label>
          <Select value={personalBroker} onChange={(e) => setPersonalBroker(e.target.value)}>
            <option value="">Multiple / other</option>
            {BROKERS.filter((b) => b.id !== "other").map((b) => (
              <option key={b.id} value={b.id}>{b.label}</option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">Imports will offer only this broker's files. Pick “Multiple / other” to keep all options.</p>
        </div>
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        <Button className="mt-4 w-full" disabled={createPersonal.isPending} onClick={() => createPersonal.mutate()}>
          {createPersonal.isPending ? "Creating…" : "Create & continue"}
        </Button>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-2xl p-8">
      <button onClick={() => setMode("choose")} className="mb-4 text-sm text-muted-foreground hover:text-foreground">← Back</button>
      <h2 className="font-serif text-xl">Add family members</h2>
      <p className="mt-1 text-sm text-muted-foreground">Each member gets their own portfolio; pick the brokers they use.</p>

      <div className="mt-5 space-y-4">
        {members.map((m, i) => (
          <div key={i} className="rounded-lg border bg-background p-4">
            <div className="flex items-center gap-2">
              <Input value={m.name} onChange={(e) => setMember(i, { name: e.target.value })} placeholder={`Member ${i + 1} name (e.g. Hanu)`} />
              {members.length > 1 && (
                <button onClick={() => setMembers((ms) => ms.filter((_, j) => j !== i))} className="shrink-0 rounded-md px-2 py-1 text-sm text-muted-foreground hover:text-destructive" aria-label="Remove">✕</button>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {BROKERS.map((b) => (
                <button
                  key={b.id}
                  onClick={() => toggleBroker(i, b.id)}
                  className={`rounded-full border px-3 py-1 text-xs ${m.brokers.includes(b.id) ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-accent"}`}
                >
                  {m.brokers.includes(b.id) ? "✓ " : ""}
                  {b.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <button onClick={() => setMembers((ms) => [...ms, { name: "", brokers: [] }])} className="mt-3 text-sm text-muted-foreground underline">
        + Add another member
      </button>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      <Button className="mt-5 w-full" disabled={createFamily.isPending} onClick={() => createFamily.mutate()}>
        {createFamily.isPending ? "Setting up…" : "Create family & continue"}
      </Button>
    </Card>
  );
}
