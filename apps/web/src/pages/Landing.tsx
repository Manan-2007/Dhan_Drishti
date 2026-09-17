import { useState } from "react";
import { Login } from "./Login.js";
import { Button } from "../components/ui.js";

const FEATURES: { title: string; body: string; accent: string }[] = [
  { title: "Consolidate every broker", body: "Import Zerodha, Dhan, or any CSV. Each statement is normalized into one canonical transaction ledger — the single source of truth.", accent: "var(--color-chart-1)" },
  { title: "Holdings you can trust", body: "Positions, average cost and invested value are derived from your ledger, never stored or guessed. Missing prices show “—”, never a fake zero.", accent: "var(--color-chart-2)" },
  { title: "Performance, honestly", body: "Realised P&L by financial year, XIRR, and a time-weighted return valued at each trade from real historical prices. Dividends tracked separately.", accent: "var(--color-chart-3)" },
  { title: "Benchmark & currency", body: "Mirror your exact cashflows into Nifty 50 or Sensex. Split foreign gains into asset vs. currency movement. Aggregate everything in your base currency.", accent: "var(--color-chart-4)" },
  { title: "Net worth with cash", body: "Record deposits and withdrawals to see true net worth — holdings plus retained cash and dividends — and a cash-inclusive time-weighted return.", accent: "var(--color-chart-5)" },
  { title: "Private by design", body: "Self-hosted on your machine. Your portfolio never leaves it — only public ticker symbols are ever sent to price providers.", accent: "var(--color-success)" },
];

const PRINCIPLES = ["No fake numbers", "Money is never a float", "No advice — just your data", "Light & dark, everywhere"];

function Mark({ color }: { color: string }) {
  return <span className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: color }} />;
}

export function Landing() {
  const [showAuth, setShowAuth] = useState(false);

  if (showAuth) {
    return (
      <div className="relative min-h-screen">
        <button
          onClick={() => setShowAuth(false)}
          className="absolute left-4 top-4 z-10 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          ← Back
        </button>
        <Login />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top bar */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-primary font-serif text-primary-foreground">द</div>
          <span className="font-serif text-xl">Dhan Drishti</span>
        </div>
        <Button variant="ghost" onClick={() => setShowAuth(true)}>Sign in</Button>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pb-16 pt-10 sm:pt-20">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Private · self-hosted · yours</p>
        <h1 className="mt-4 max-w-3xl font-serif text-4xl leading-tight sm:text-6xl">
          Every rupee you&apos;ve invested, in one clear view.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
          Dhan Drishti consolidates your brokers and platforms into one normalized ledger, then derives your
          holdings, performance and net worth — with numbers that always trace back to a real transaction.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button className="h-11 px-6 text-base" onClick={() => setShowAuth(true)}>Get started</Button>
          <Button variant="secondary" className="h-11 px-6 text-base" onClick={() => setShowAuth(true)}>Sign in</Button>
          <span className="text-sm text-muted-foreground">Your data never leaves your machine.</span>
        </div>
      </section>

      {/* Features */}
      <section className="border-t bg-card/40">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="font-serif text-2xl">Built like a proper wealth tracker — without the surveillance.</h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-lg border bg-card p-5">
                <div className="flex items-start gap-2.5">
                  <Mark color={f.accent} />
                  <h3 className="font-medium">{f.title}</h3>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Principles */}
      <section className="mx-auto max-w-6xl px-6 py-14">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          {PRINCIPLES.map((p) => (
            <span key={p} className="flex items-center gap-2 text-sm">
              <span className="text-success">✓</span> {p}
            </span>
          ))}
        </div>
        <div className="mt-10 rounded-xl border bg-card p-8 text-center">
          <h2 className="font-serif text-2xl">Ready to see your whole portfolio?</h2>
          <p className="mx-auto mt-2 max-w-xl text-muted-foreground">
            Create a local account, import a broker CSV, and watch your dashboard fill with real, derived figures.
          </p>
          <div className="mt-6">
            <Button className="h-11 px-6 text-base" onClick={() => setShowAuth(true)}>Get started</Button>
          </div>
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-6 py-6 text-sm text-muted-foreground">
          <span>Dhan Drishti — a private investment portfolio & wealth tracker.</span>
          <span>Runs on your machine. No accounts sold, no data shared.</span>
        </div>
      </footer>
    </div>
  );
}
