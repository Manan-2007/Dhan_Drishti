import { useState } from "react";
import { Login } from "./Login.js";
import { Button } from "../components/ui.js";

/* ---------- inline icons (no dependency) ---------- */
type IconProps = { className?: string };
const Icon = {
  upload: (p: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={p.className}><path d="M12 15V3m0 0L8 7m4-4 4 4" /><path d="M3 15v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4" /></svg>
  ),
  chart: (p: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={p.className}><path d="M3 3v18h18" /><path d="M7 15l3-4 3 3 4-6" /></svg>
  ),
  scale: (p: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={p.className}><path d="M12 3v18M5 7h14M5 7l-2.5 6a3 3 0 0 0 5 0L5 7Zm14 0-2.5 6a3 3 0 0 0 5 0L19 7Z" /></svg>
  ),
  globe: (p: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={p.className}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" /></svg>
  ),
  wallet: (p: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={p.className}><path d="M3 7a2 2 0 0 1 2-2h12v4" /><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2H5" /><circle cx="16.5" cy="12.5" r="1.3" fill="currentColor" stroke="none" /></svg>
  ),
  shield: (p: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={p.className}><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z" /><path d="M9.5 12l1.8 1.8L15 10" /></svg>
  ),
};

const FEATURES = [
  { icon: Icon.upload, color: "var(--color-chart-1)", title: "Every broker, one ledger", body: "Zerodha, Dhan, Vested & Interactive Brokers, Binance, or any CSV — normalized into one canonical transaction ledger." },
  { icon: Icon.chart, color: "var(--color-chart-2)", title: "Holdings you can trust", body: "Average-cost positions, invested value and realised P&L derived from your ledger. Missing prices show “—”, never a fake zero." },
  { icon: Icon.scale, color: "var(--color-chart-3)", title: "Performance, honestly", body: "Realised P&L by financial year, XIRR, and a time-weighted return valued at each trade from real historical prices." },
  { icon: Icon.globe, color: "var(--color-chart-4)", title: "Benchmark & currency", body: "Mirror your cashflows into Nifty 50 or Sensex, split foreign gains into asset vs. currency, aggregate in your base currency." },
  { icon: Icon.wallet, color: "var(--color-chart-5)", title: "Net worth with cash", body: "Record deposits and withdrawals for true net worth — holdings plus retained cash and dividends." },
  { icon: Icon.shield, color: "var(--color-success)", title: "Private by design", body: "Runs on your own machine. Your portfolio never leaves it — only public ticker symbols are ever sent out." },
];

const STEPS = [
  { n: "1", title: "Import", body: "Upload broker CSVs — trades, funds and dividends. Deduped and idempotent." },
  { n: "2", title: "Derive", body: "Holdings, allocation, performance and net worth are computed from the ledger." },
  { n: "3", title: "See", body: "A clear dashboard where every figure traces back to a real transaction." },
];

/* ---------- a stylized product preview for the hero ---------- */
function DashboardPreview() {
  const donut = [
    { v: 46, c: "var(--color-chart-1)" },
    { v: 24, c: "var(--color-chart-2)" },
    { v: 18, c: "var(--color-chart-3)" },
    { v: 12, c: "var(--color-chart-4)" },
  ];
  const C = 2 * Math.PI * 32;
  let acc = 0;
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-2xl shadow-black/20 ring-1 ring-black/5">
      <div className="mb-4 flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-destructive/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
        <span className="ml-2 text-xs text-muted-foreground">Dashboard</span>
      </div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">Net worth</div>
      <div className="flex items-baseline gap-2">
        <div className="font-mono text-3xl tabular">₹1.26 Cr</div>
        <div className="font-mono text-sm text-success tabular">▲ 13.6%</div>
      </div>
      <div className="mt-4 flex items-center gap-5">
        <svg viewBox="0 0 80 80" className="h-24 w-24 shrink-0 -rotate-90">
          {donut.map((d, i) => {
            const dash = (d.v / 100) * C;
            const seg = <circle key={i} cx="40" cy="40" r="32" fill="none" stroke={d.c} strokeWidth="12" strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc} />;
            acc += dash;
            return seg;
          })}
        </svg>
        <div className="flex-1 space-y-2">
          {[
            { label: "Equity", w: "46%", c: "var(--color-chart-1)" },
            { label: "Debt", w: "24%", c: "var(--color-chart-2)" },
            { label: "Gold / SGB", w: "18%", c: "var(--color-chart-3)" },
            { label: "Cash", w: "12%", c: "var(--color-chart-4)" },
          ].map((r) => (
            <div key={r.label}>
              <div className="mb-0.5 flex justify-between text-xs">
                <span className="text-muted-foreground">{r.label}</span>
                <span className="font-mono tabular">{r.w}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full" style={{ width: r.w, backgroundColor: r.c }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Landing() {
  const [showAuth, setShowAuth] = useState(false);
  if (showAuth) {
    return (
      <div className="relative min-h-screen">
        <button onClick={() => setShowAuth(false)} className="absolute left-4 top-4 z-10 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">← Back</button>
        <Login />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top bar */}
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary font-serif text-primary-foreground">द</div>
            <span className="font-serif text-xl">Dhan Drishti</span>
          </div>
          <Button variant="secondary" onClick={() => setShowAuth(true)}>Sign in</Button>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 -z-10 opacity-70"
          style={{ background: "radial-gradient(60rem 40rem at 85% -10%, color-mix(in oklab, var(--color-chart-1) 22%, transparent), transparent 60%), radial-gradient(50rem 40rem at 0% 10%, color-mix(in oklab, var(--color-primary) 12%, transparent), transparent 55%)" }}
        />
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 sm:py-24 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-success" /> Private · self-hosted · yours
            </span>
            <h1 className="mt-5 font-serif text-4xl leading-[1.05] sm:text-6xl">
              All your wealth,<br />in one honest view.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted-foreground">
              Dhan Drishti consolidates every broker into one normalized ledger, then derives your holdings,
              performance and net worth — with numbers that always trace back to a real transaction.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button className="h-11 px-6 text-base" onClick={() => setShowAuth(true)}>Get started — it's local</Button>
              <Button variant="secondary" className="h-11 px-6 text-base" onClick={() => setShowAuth(true)}>Sign in</Button>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">No sign-up server. No data leaves your machine.</p>
          </div>
          <div className="lg:pl-6">
            <DashboardPreview />
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t bg-card/30">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="max-w-2xl font-serif text-2xl sm:text-3xl">A proper wealth tracker — without the surveillance.</h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => {
              const I = f.icon;
              return (
                <div key={f.title} className="rounded-xl border bg-card p-5 transition-colors hover:border-foreground/20">
                  <div className="grid h-10 w-10 place-items-center rounded-lg" style={{ backgroundColor: `color-mix(in oklab, ${f.color} 18%, transparent)`, color: f.color }}>
                    <I className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 font-medium">{f.title}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">{f.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-6 sm:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="rounded-xl border bg-card p-6">
              <div className="grid h-9 w-9 place-items-center rounded-full border font-mono text-sm text-muted-foreground">{s.n}</div>
              <h3 className="mt-4 font-serif text-lg">{s.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="overflow-hidden rounded-2xl border bg-card p-10 text-center">
          <h2 className="font-serif text-2xl sm:text-3xl">See your whole portfolio in minutes.</h2>
          <p className="mx-auto mt-2 max-w-xl text-muted-foreground">Create a local account, import a broker export, and watch your dashboard fill with real, derived figures.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button className="h-11 px-6 text-base" onClick={() => setShowAuth(true)}>Get started</Button>
          </div>
          <div className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <span>✓ No fake numbers</span>
            <span>✓ Money is never a float</span>
            <span>✓ No advice — just your data</span>
            <span>✓ Light & dark</span>
          </div>
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-6 py-6 text-sm text-muted-foreground">
          <span className="flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded bg-primary font-serif text-xs text-primary-foreground">द</span> Dhan Drishti</span>
          <span>Runs on your machine. No accounts sold, no data shared.</span>
        </div>
      </footer>
    </div>
  );
}
