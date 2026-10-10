import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  BellRing,
  ChartCandlestick,
  Check,
  FileSpreadsheet,
  Globe,
  HeartPulse,
  Landmark,
  Laptop,
  Lock,
  Newspaper,
  Receipt,
  ShieldCheck,
  Sparkles,
  Split,
  Upload,
  Users,
} from "lucide-react";
import { Background } from "@/components/shell/Background";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BrokerMark, SourceChip, SOURCES } from "./BrokerMarks";

const ease = [0.22, 1, 0.36, 1] as const;

/** Rises into place as it scrolls into view (once). */
function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.6, delay, ease }}
    >
      {children}
    </motion.div>
  );
}

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="flex shrink-0 items-center gap-2.5" aria-label="Dhan Drishti home">
      <span className="grid size-10 place-items-center rounded-full bg-primary font-display text-2xl leading-none text-primary-foreground">द</span>
      <span className={cn("text-sm font-semibold tracking-[0.18em] whitespace-nowrap uppercase", compact && "hidden sm:inline")}>Dhan Drishti</span>
    </Link>
  );
}

/**
 * The signed-out front door: what Dhan Drishti is, what it reads, what it shows, and why your data
 * is safe with it — then sign in or create an account.
 */
export function PublicHome() {
  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <Background />
      <TopBar />
      <main className="relative z-10">
        <Hero />
        <SourcesStrip />
        <DropFlow />
        <Features />
        <HowItWorks />
        <Privacy />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}

function TopBar() {
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:gap-6 sm:px-6">
        <Logo compact />
        <nav className="ml-6 hidden items-center gap-6 text-sm text-muted-foreground md:flex" aria-label="Sections">
          <a href="#features" className="hover:text-foreground">Features</a>
          <a href="#brokers" className="hover:text-foreground">Brokers</a>
          <a href="#how" className="hover:text-foreground">How it works</a>
          <a href="#privacy" className="hover:text-foreground">Privacy</a>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" asChild>
            <Link to="/signin">Sign in</Link>
          </Button>
          <Button asChild>
            <Link to="/signup">
              Get started <ArrowRight />
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

// ---- Hero -----------------------------------------------------------------------------------------

function Hero() {
  const reduce = useReducedMotion();
  const rise = (delay: number) => (reduce ? {} : { initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 }, transition: { delay, duration: 0.6, ease } });
  return (
    <section className="mx-auto grid max-w-6xl items-center gap-14 px-4 pt-16 pb-20 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-24">
      <div>
        <motion.p {...rise(0)} className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground">
          <span className="size-1.5 rounded-full bg-gain" /> Your portfolio tracker, running on your own computer
        </motion.p>
        <motion.h1 {...rise(0.06)} className="mt-6 font-display text-6xl leading-[0.92] tracking-tight sm:text-7xl xl:text-8xl">
          All your money.
          <br />
          <span className="text-primary italic">One honest view.</span>
        </motion.h1>
        <motion.p {...rise(0.14)} className="mt-7 max-w-xl text-lg leading-relaxed text-muted-foreground">
          Zerodha, Dhan, Vested, your mutual funds, your family's accounts — drop in the files your brokers already give you, and see your whole net worth, every gain, every gap, in one place.
        </motion.p>
        <motion.div {...rise(0.22)} className="mt-9 flex flex-wrap items-center gap-3">
          <Button size="lg" asChild className="h-12 px-6 text-base">
            <Link to="/signup">
              Create your account <ArrowRight />
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild className="h-12 px-6 text-base">
            <Link to="/signin">I have an account</Link>
          </Button>
        </motion.div>
        <motion.ul {...rise(0.3)} className="mt-9 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
          {["No subscription", "No bank logins", "Your data never leaves this machine"].map((t) => (
            <li key={t} className="flex items-center gap-2">
              <Check className="size-4 text-gain" /> {t}
            </li>
          ))}
        </motion.ul>
      </div>
      <HeroPreview />
    </section>
  );
}

/** An illustration of the app: amounts masked on purpose — they're yours, not ours. */
function HeroPreview() {
  const reduce = useReducedMotion();
  const line = "M0,150 C40,140 60,120 95,124 S150,92 185,98 S240,70 275,76 S330,40 360,46 S410,20 440,24";
  const float = (d: number) => (reduce ? {} : { animate: { y: [0, -8, 0] }, transition: { duration: 5, repeat: Infinity, ease: "easeInOut" as const, delay: d } });
  return (
    <motion.div className="relative" initial={reduce ? false : { opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.8, delay: 0.15, ease }}>
      <div className="relative overflow-hidden rounded-3xl border bg-card shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)]">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <span className="size-2.5 rounded-full bg-loss/70" />
          <span className="size-2.5 rounded-full bg-primary/70" />
          <span className="size-2.5 rounded-full bg-gain/70" />
          <span className="ml-3 rounded-full bg-raised px-3 py-0.5 text-[11px] text-muted-foreground">localhost · Dhan Drishti</span>
        </div>
        <div className="space-y-5 p-6">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">Net worth · everyone</p>
              <p className="mt-1 font-display text-4xl tracking-tight whitespace-nowrap sm:text-5xl">
                ₹ <span className="tracking-[0.12em] text-foreground/80">••,••,•••</span>
              </p>
            </div>
            <span className="hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] text-muted-foreground sm:flex">
              <Lock className="size-3" /> Only on your screen
            </span>
          </div>
          <svg viewBox="0 0 440 170" className="h-40 w-full" aria-hidden>
            {[40, 80, 120].map((y) => (
              <line key={y} x1="0" x2="440" y1={y} y2={y} stroke="#26262c" strokeDasharray="3 5" />
            ))}
            <motion.path d={line} fill="none" stroke="#3ec98a" strokeWidth="3" strokeLinecap="round" initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 2, delay: 0.5, ease }} />
            <motion.path
              d="M0,160 C60,154 120,140 185,132 S300,110 440,96"
              fill="none"
              stroke="#9c978c"
              strokeWidth="1.5"
              strokeDasharray="4 5"
              initial={reduce ? false : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 2, delay: 0.7, ease }}
            />
            {[
              [95, 124],
              [185, 98],
              [275, 76],
              [360, 46],
            ].map(([x, y], i) => (
              <motion.circle key={x} cx={x} cy={y} r="5" fill="#f0b23e" stroke="#141417" strokeWidth="2" initial={reduce ? false : { scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 1.1 + i * 0.25 }} />
            ))}
          </svg>
          <div>
            <div className="flex h-2.5 overflow-hidden rounded-full">
              {[
                ["#f0b23e", 44],
                ["#8c8fe0", 24],
                ["#5fb7a6", 14],
                ["#d97757", 10],
                ["#d9d2c3", 8],
              ].map(([c, w], i) => (
                <motion.span key={c} style={{ backgroundColor: c as string }} initial={reduce ? false : { width: 0 }} animate={{ width: `${w}%` }} transition={{ duration: 0.9, delay: 0.9 + i * 0.12, ease }} />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              {["Shares", "Mutual funds", "Debt", "Gold", "Cash"].map((l, i) => (
                <span key={l} className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ backgroundColor: ["#f0b23e", "#8c8fe0", "#5fb7a6", "#d97757", "#d9d2c3"][i] }} />
                  {l}
                </span>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            {(["zerodha", "vested", "cas"] as const).map((id, i) => (
              <motion.div
                key={id}
                className="flex items-center gap-3 rounded-xl bg-raised/60 px-3 py-2"
                initial={reduce ? false : { opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 1.2 + i * 0.15, duration: 0.5, ease }}
              >
                <BrokerMark id={id} size={28} />
                <span className="flex-1 text-sm">{SOURCES.find((s) => s.id === id)!.name}</span>
                <span className="h-1.5 w-20 overflow-hidden rounded-full bg-border">
                  <span className="block h-full rounded-full bg-gain" style={{ width: `${[72, 48, 61][i]}%` }} />
                </span>
                <Check className="size-4 text-gain" />
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      <motion.div {...float(0)} className="absolute -top-5 -left-4 hidden rounded-2xl border bg-popover px-3.5 py-2.5 text-xs shadow-xl sm:block">
        <p className="flex items-center gap-1.5 font-semibold">
          <Split className="size-3.5 text-gain" /> Stock split filled in
        </p>
        <p className="mt-0.5 text-muted-foreground">from public data, checked against your trades</p>
      </motion.div>
      <motion.div {...float(1.4)} className="absolute top-1/2 -right-5 hidden rounded-2xl border bg-popover px-3.5 py-2.5 text-xs shadow-xl sm:block">
        <p className="flex items-center gap-1.5 font-semibold">
          <BellRing className="size-3.5 text-primary" /> Needs attention
        </p>
        <p className="mt-0.5 text-muted-foreground">Add the tradebook from 1 Apr to today</p>
      </motion.div>
      <motion.div {...float(2.6)} className="absolute -bottom-5 left-10 hidden rounded-2xl border bg-popover px-3.5 py-2.5 text-xs shadow-xl sm:block">
        <p className="flex items-center gap-1.5 font-semibold">
          🇺🇸 → ₹ <span className="font-normal text-muted-foreground">US shares in rupees, at the rate you paid</span>
        </p>
      </motion.div>
    </motion.div>
  );
}

// ---- Sources -------------------------------------------------------------------------------------

function SourcesStrip() {
  return (
    <section id="brokers" className="scroll-mt-20 border-y border-border/60 bg-background/70 py-12">
      <Reveal className="mx-auto max-w-6xl px-4 sm:px-6">
        <p className="text-center text-sm text-muted-foreground">Works with the files your brokers already give you — no logins, no linking</p>
      </Reveal>
      <div className="group relative mt-8 overflow-hidden">
        <div className="marquee-track flex w-max gap-4 group-hover:[animation-play-state:paused]" style={{ ["--marquee-duration" as string]: "40s" }}>
          {[...SOURCES, ...SOURCES].map((s, i) => (
            <SourceChip key={`${s.id}-${i}`} id={s.id} />
          ))}
        </div>
      </div>
    </section>
  );
}

// ---- Drop flow -----------------------------------------------------------------------------------

const FILES = [
  { name: "tradebook-EQ.csv", id: "zerodha" },
  { name: "Vested_Transactions.xlsx", id: "vested" },
  { name: "CAS_statement.pdf", id: "cas" },
  { name: "All_Transactions.csv", id: "dhan" },
  { name: "taxpnl-FY25.xlsx", id: "zerodha" },
] as const;

function DropFlow() {
  const reduce = useReducedMotion();
  return (
    <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-24 sm:px-6 lg:grid-cols-2">
      <Reveal>
        <p className="text-xs font-semibold tracking-[0.16em] text-primary uppercase">Drop everything</p>
        <h2 className="mt-3 font-display text-5xl leading-[0.98] tracking-tight">It works out the rest.</h2>
        <p className="mt-5 max-w-lg text-muted-foreground">
          Drag in a whole folder of statements at once. Dhan Drishti recognises each broker, account and person on its own, skips anything it has already seen, and tells you exactly what changed.
        </p>
        <ul className="mt-7 space-y-3 text-sm">
          {[
            "Recognises the broker, the account and whose it is",
            "Never counts the same trade twice",
            "Checks your profit against the broker's own P&L report",
            "Fills in stock splits your files leave out, from public data",
          ].map((t) => (
            <li key={t} className="flex items-start gap-3">
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-gain/15">
                <Check className="size-3 text-gain" />
              </span>
              {t}
            </li>
          ))}
        </ul>
      </Reveal>

      <Reveal delay={0.1}>
        <div className="relative rounded-3xl border bg-card p-6">
          <div className="space-y-2.5">
            {FILES.map((f, i) => (
              <motion.div
                key={f.name}
                className="flex items-center gap-3 rounded-xl border bg-raised/50 px-3 py-2.5"
                initial={reduce ? false : { opacity: 0, y: -14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.15 + i * 0.12, duration: 0.45, ease }}
              >
                <FileSpreadsheet className="size-4 text-muted-foreground" />
                <span className="flex-1 truncate text-sm">{f.name}</span>
                <BrokerMark id={f.id} size={22} />
                <motion.span
                  className="text-[11px] font-medium text-gain"
                  initial={reduce ? false : { opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.9 + i * 0.15 }}
                >
                  recognised
                </motion.span>
              </motion.div>
            ))}
          </div>
          <motion.div
            className="mt-5 flex items-center gap-3 rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 px-4 py-5"
            initial={reduce ? false : { opacity: 0, scale: 0.97 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 1.6, duration: 0.5, ease }}
          >
            <span className="grid size-10 place-items-center rounded-full bg-primary text-primary-foreground">
              <Upload className="size-5" />
            </span>
            <div className="text-sm">
              <p className="font-semibold">5 files · 3 accounts · 2 people</p>
              <p className="text-muted-foreground">Ready to add — nothing counted twice</p>
            </div>
          </motion.div>
        </div>
      </Reveal>
    </section>
  );
}

// ---- Features --------------------------------------------------------------------------------------

function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
      <Reveal className="max-w-2xl">
        <p className="text-xs font-semibold tracking-[0.16em] text-primary uppercase">What you get</p>
        <h2 className="mt-3 font-display text-5xl leading-[0.98] tracking-tight">Everything your brokers know — finally in one place.</h2>
      </Reveal>
      <div className="mt-12 grid gap-4 md:grid-cols-6">
        <Reveal className="md:col-span-4">
          <FeatureCard icon={Landmark} title="One honest net worth" body="Every account, every family member, India and the US — added up properly. US shares in rupees at the rate you actually paid, so the dollar's move is part of your gain.">
            <div className="mt-6 flex flex-wrap items-center gap-2">
              {["You", "Mom", "Dad"].map((p) => (
                <span key={p} className="flex items-center gap-2 rounded-full border bg-raised/50 px-3 py-1.5 text-xs">
                  <Users className="size-3.5 text-muted-foreground" /> {p}
                </span>
              ))}
              <span className="text-muted-foreground">×</span>
              {(["zerodha", "dhan", "vested"] as const).map((id) => (
                <BrokerMark key={id} id={id} size={28} />
              ))}
              <span className="text-muted-foreground">=</span>
              <span className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">One view</span>
            </div>
          </FeatureCard>
        </Reveal>
        <Reveal className="md:col-span-2" delay={0.05}>
          <FeatureCard icon={BellRing} title="Tells you what's missing" body="A sale with no purchase on record? A gap between files? It names the stock, the account and the exact file — with its dates — that fixes it.">
            <div className="mt-5 rounded-xl border border-primary/25 bg-primary/5 p-3 text-xs">
              <p className="font-semibold tracking-wide text-primary uppercase">What fixes it</p>
              <p className="mt-1.5 flex items-center gap-2">
                <BrokerMark id="zerodha" size={18} /> Zerodha tradebook · Equity
              </p>
              <p className="mt-1 text-muted-foreground">From 1 Apr to today</p>
            </div>
          </FeatureCard>
        </Reveal>
        <Reveal className="md:col-span-2">
          <FeatureCard icon={ChartCandlestick} title="Research any stock" body="Search anything listed in India or the US: price history, ranges, RSI, moving averages, fundamentals and the latest news." />
        </Reveal>
        <Reveal className="md:col-span-2" delay={0.05}>
          <FeatureCard icon={Newspaper} title="News on what you own" body="Headlines about your holdings, refreshed on their own — with an optional AI read of the risks and the outlook." />
        </Reveal>
        <Reveal className="md:col-span-2" delay={0.1}>
          <FeatureCard icon={Receipt} title="Tax-ready gains" body="Capital gains matched the way the tax rules do (first in, first out), split into short and long term, by financial year." />
        </Reveal>
        <Reveal className="md:col-span-3">
          <FeatureCard icon={HeartPulse} title="A health check for your portfolio" body="Concentration, cash drag, sector skew — a plain-language x-ray of how your money is spread, worked out on your machine.">
            <HealthRing />
          </FeatureCard>
        </Reveal>
        <Reveal className="md:col-span-3" delay={0.05}>
          <FeatureCard icon={Sparkles} title="Returns you can trust" body="Time-weighted and money-weighted returns, a benchmark against the Nifty or S&P 500, dividends and income — every figure traced back to a real trade.">
            <MiniBars />
          </FeatureCard>
        </Reveal>
      </div>
    </section>
  );
}

function FeatureCard({ icon: Icon, title, body, children }: { icon: typeof Lock; title: string; body: string; children?: ReactNode }) {
  return (
    <div className="h-full rounded-3xl border bg-card p-6 transition-colors hover:border-primary/40">
      <span className="grid size-10 place-items-center rounded-xl bg-raised text-primary">
        <Icon className="size-5" />
      </span>
      <h3 className="mt-5 text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
      {children}
    </div>
  );
}

function HealthRing() {
  const reduce = useReducedMotion();
  return (
    <div className="mt-6 flex items-center gap-5">
      <svg viewBox="0 0 80 80" className="size-20 -rotate-90" aria-hidden>
        <circle cx="40" cy="40" r="32" fill="none" stroke="#26262c" strokeWidth="8" />
        <motion.circle
          cx="40"
          cy="40"
          r="32"
          fill="none"
          stroke="#3ec98a"
          strokeWidth="8"
          strokeLinecap="round"
          initial={reduce ? false : { pathLength: 0 }}
          whileInView={{ pathLength: 0.78 }}
          viewport={{ once: true }}
          transition={{ duration: 1.4, ease }}
        />
      </svg>
      <div className="space-y-1.5 text-xs">
        {[
          ["Spread across sectors", "text-gain"],
          ["One stock is a big share", "text-primary"],
          ["Little cash sitting idle", "text-gain"],
        ].map(([t, c]) => (
          <p key={t} className="flex items-center gap-2">
            <span className={cn("size-1.5 rounded-full bg-current", c)} />
            <span className="text-muted-foreground">{t}</span>
          </p>
        ))}
      </div>
    </div>
  );
}

function MiniBars() {
  const reduce = useReducedMotion();
  const bars = [38, 52, 30, 64, 46, 72, 58, 80, 66, 88];
  return (
    <div className="mt-6 flex h-20 items-end gap-2" aria-hidden>
      {bars.map((h, i) => (
        <motion.span
          key={i}
          className={cn("flex-1 rounded-t-md", i % 4 === 2 ? "bg-loss/70" : "bg-gain/70")}
          initial={reduce ? false : { height: 0 }}
          whileInView={{ height: `${h}%` }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, delay: i * 0.06, ease }}
        />
      ))}
    </div>
  );
}

// ---- How it works ------------------------------------------------------------------------------------

function HowItWorks() {
  const steps = [
    { n: "01", title: "Create your account", body: "It lives on this computer — a username and a password, nothing else.", icon: Laptop },
    { n: "02", title: "Pick your brokers", body: "Just you, or the whole family? Tell it which brokers you use and it sets up the accounts.", icon: Users },
    { n: "03", title: "Drop in your files", body: "Tradebooks, statements, the mutual-fund CAS. Two minutes later, everything is in view.", icon: Upload },
  ];
  return (
    <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
      <Reveal className="text-center">
        <p className="text-xs font-semibold tracking-[0.16em] text-primary uppercase">How it works</p>
        <h2 className="mt-3 font-display text-5xl tracking-tight">Up and running in two minutes.</h2>
      </Reveal>
      <div className="relative mt-14 grid gap-5 md:grid-cols-3">
        <div className="absolute top-12 right-[16%] left-[16%] hidden h-px border-t border-dashed border-primary/40 md:block" aria-hidden />
        {steps.map((s, i) => (
          <Reveal key={s.n} delay={i * 0.12}>
            <div className="relative h-full rounded-3xl border bg-card p-6 text-center">
              <span className="mx-auto grid size-14 place-items-center rounded-2xl border bg-raised text-primary">
                <s.icon className="size-6" />
              </span>
              <p className="mt-5 text-xs font-semibold tracking-[0.16em] text-muted-foreground">{s.n}</p>
              <h3 className="mt-1 text-lg font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

// ---- Privacy --------------------------------------------------------------------------------------------

function Privacy() {
  return (
    <section id="privacy" className="scroll-mt-20 border-y border-border/60 bg-background/80 py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[1fr_1.1fr]">
        <Reveal>
          <p className="text-xs font-semibold tracking-[0.16em] text-primary uppercase">Private by design</p>
          <h2 className="mt-3 font-display text-5xl leading-[0.98] tracking-tight">Your numbers never leave your machine.</h2>
          <p className="mt-5 max-w-lg text-muted-foreground">
            Dhan Drishti runs on your own computer. There's no cloud account, no bank login and nobody else's server holding your portfolio. To fetch prices and news it sends only public ticker symbols and dates — never what you own or how much.
          </p>
        </Reveal>
        <Reveal delay={0.1}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-3xl border border-gain/30 bg-card p-6">
              <p className="flex items-center gap-2 font-semibold">
                <ShieldCheck className="size-5 text-gain" /> Stays with you
              </p>
              <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
                {["What you hold, and how much", "What you paid and what you made", "Account numbers, names, PAN", "Your family's portfolios"].map((t) => (
                  <li key={t} className="flex items-start gap-2">
                    <Lock className="mt-0.5 size-3.5 shrink-0 text-gain" /> {t}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-3xl border bg-card p-6">
              <p className="flex items-center gap-2 font-semibold">
                <Globe className="size-5 text-muted-foreground" /> Only this goes out
              </p>
              <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
                {["Public tickers, for prices", "Currency pairs, for exchange rates", "Company names, for news", "Dates, for price history"].map((t) => (
                  <li key={t} className="flex items-start gap-2">
                    <ArrowRight className="mt-0.5 size-3.5 shrink-0" /> {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              ["7", "file formats read"],
              ["2", "markets · India & US"],
              ["0", "subscriptions"],
              ["100%", "on your computer"],
            ].map(([n, l]) => (
              <div key={l} className="rounded-2xl border bg-card px-4 py-3">
                <p className="font-display text-3xl">{n}</p>
                <p className="text-xs text-muted-foreground">{l}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ---- Closing ------------------------------------------------------------------------------------------------

function FinalCta() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
      <Reveal>
        <div className="relative overflow-hidden rounded-[2rem] border bg-card px-6 py-16 text-center sm:px-12">
          <div className="pointer-events-none absolute inset-x-0 top-6 flex justify-center gap-3 opacity-60" aria-hidden>
            {SOURCES.slice(0, 6).map((s, i) => (
              <motion.span key={s.id} animate={{ y: [0, -6, 0] }} transition={{ duration: 4, repeat: Infinity, delay: i * 0.3, ease: "easeInOut" }}>
                <BrokerMark id={s.id} size={30} />
              </motion.span>
            ))}
          </div>
          <h2 className="mt-10 font-display text-5xl leading-[0.98] tracking-tight sm:text-6xl">
            Know exactly <span className="text-primary italic">where you stand.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-muted-foreground">Create an account on this computer and bring in your first files. It takes about two minutes.</p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Button size="lg" asChild className="h-12 px-6 text-base">
              <Link to="/signup">
                Get started — it's free <ArrowRight />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild className="h-12 px-6 text-base">
              <Link to="/signin">Sign in</Link>
            </Button>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

function Footer() {
  return (
    <footer className="relative z-10 border-t border-border/60 bg-background">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-xs text-muted-foreground sm:px-6">
        <Logo />
        <p className="max-w-md">A self-hosted portfolio tracker. Figures are for your information — nothing here is investment advice. Broker names belong to their owners; the marks above are ours.</p>
      </div>
    </footer>
  );
}
