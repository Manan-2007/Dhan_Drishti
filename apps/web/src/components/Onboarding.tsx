import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Portfolio } from "../lib/api.js";
import { BROKER_CHOICES } from "../lib/brokers.js";
import { Button, Card, Input } from "./ui.js";

const BROKERS = BROKER_CHOICES;
/** Accounts for the brokers picked: US brokers hold dollars. */
const accountsFor = (brokers: string[], prefix = "") =>
  brokers.map((b) => ({ name: `${prefix}${BROKERS.find((x) => x.id === b)?.label ?? b}`, broker: b, currency: b === "vested" || b === "ibkr" ? "USD" : "INR" }));

/** Broker chips — tap to pick as many as apply. */
function BrokerPicker({ value, onToggle }: { value: string[]; onToggle: (id: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {BROKERS.map((b) => {
        const on = value.includes(b.id);
        return (
          <button
            key={b.id}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(b.id)}
            className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${on ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-accent"}`}
          >
            {on ? "✓ " : ""}
            {b.label}
            {b.hint && <span className="ml-1 text-xs opacity-70">· {b.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}

interface Member {
  name: string;
  brokers: string[];
}

/** First-run setup: choose personal or family, then create member portfolios and their brokers. */
export function Onboarding() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"choose" | "personal" | "family">("choose");
  const [personalName, setPersonalName] = useState("");
  const [personalBrokers, setPersonalBrokers] = useState<string[]>([]);
  const [members, setMembers] = useState<Member[]>([{ name: "", brokers: [] }]);
  const [error, setError] = useState<string | null>(null);

  const done = () => qc.invalidateQueries();

  const createPersonal = useMutation({
    mutationFn: async () => {
      // You, plus one account per broker you use — created together in one step, so it never
      // half-lands. Files then find their account on their own, and every page can show all your
      // brokers together or one at a time.
      await api.post<{ portfolio: Portfolio }>("/api/portfolios", { name: personalName.trim() || "Me", kind: "custom", accounts: accountsFor(personalBrokers) });
    },
    onSuccess: done,
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not create"),
  });

  const createFamily = useMutation({
    mutationFn: async () => {
      const valid = members.filter((m) => m.name.trim());
      if (valid.length === 0) throw new ApiError(400, "no_members", "Add at least one member");
      for (const m of valid) {
        await api.post("/api/portfolios", { name: m.name.trim(), kind: "family", accounts: accountsFor(m.brokers, `${m.name.trim()} · `) });
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
            <p className="mt-1 text-sm text-muted-foreground">Your own money, across every broker you use.</p>
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
        <h2 className="font-serif text-xl">What should we call you?</h2>
        <div className="mt-4 space-y-1.5">
          <Input value={personalName} onChange={(e) => setPersonalName(e.target.value)} placeholder="Your name, e.g. Manan" autoFocus />
        </div>
        <div className="mt-6 space-y-2">
          <label className="text-sm font-medium">Which brokers do you use?</label>
          <BrokerPicker value={personalBrokers} onToggle={(b) => setPersonalBrokers((v) => (v.includes(b) ? v.filter((x) => x !== b) : [...v, b]))} />
          <p className="text-xs text-muted-foreground">
            {personalBrokers.length === 0
              ? "Pick every broker you have an account with. You can add more later, or just drop their files in."
              : `${personalBrokers.length} broker account${personalBrokers.length === 1 ? "" : "s"} — see them together, or filter to one, anywhere in the app.`}
          </p>
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
            <div className="mt-3">
              <BrokerPicker value={m.brokers} onToggle={(b) => toggleBroker(i, b)} />
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
