import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowRight,
  CheckCircle2,
  CircleSlash,
  FileQuestion,
  FileSpreadsheet,
  HelpCircle,
  KeyRound,
  Loader2,
  Layers,
  RotateCcw,
  Scale,
  ShieldCheck,
  Tags,
  Upload,
  X,
} from "lucide-react";
import CountUp from "@/components/reactbits/CountUp";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Segmented } from "@/components/kit/Segmented";
import { GUIDES } from "@/components/ExportHelp";
import { useDropFiles } from "@/components/shell/DropContext";
import { api, ApiError, type CommitManyItem, type CommitManyResult, type CommitTarget, type PnlReconcile, type UploadDetection } from "@/lib/api";
import { useAllAccounts, usePortfolios } from "@/lib/hooks";
import { loadFiles, type LoadedFile } from "@/lib/files";
import { compactMoney, dateShort, signedMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

const BROKER_NAMES: Record<string, string> = { zerodha: "Zerodha", dhan: "Dhan", vested: "Vested", ibkr: "Interactive Brokers", binance: "Binance", generic: "Other" };
const brokerName = (b: string | null | undefined) => (b ? (BROKER_NAMES[b] ?? b) : "Broker");

interface Item {
  file: LoadedFile;
  status: "detecting" | "ready";
  detection: UploadDetection | null;
  include: boolean;
  password: string;
}

type Answer =
  | { mode: "existing"; accountId: string; adoptRef: string | null }
  | { mode: "new"; ownerId: string; newOwnerName: string; accountName: string; broker: string; accountRef: string | null; currency: string };

/** Files that need an account: ledger files with something new to add, and P&L reports to check it against. */
const needsAccount = (it: Item) =>
  it.include && ((it.detection?.kind === "transactions" && (it.detection.counts?.toImport ?? 0) > 0) || it.detection?.kind === "pnl_report");
const willImport = (it: Item) => it.include && (needsAccount(it) || (it.detection?.kind === "prices" && (it.detection.priceRows ?? 0) > 0));

/**
 * One question per account, not per file: files are grouped by the client code printed in them,
 * and a file with no code joins the only group from the same broker in this drop.
 */
function groupKeyFor(it: Item, items: Item[]): string {
  const d = it.detection!;
  if (d.accountRef) return `ref:${d.accountRef}`;
  if (d.brokerFamily) {
    const refs = new Set(items.filter((o) => o.detection?.brokerFamily === d.brokerFamily && o.detection.accountRef).map((o) => o.detection!.accountRef));
    if (refs.size === 1) return `ref:${[...refs][0]}`;
  }
  return `file:${it.file.id}`;
}

async function detectOne(file: LoadedFile, password?: string): Promise<UploadDetection> {
  const res = await api.post<{ detection: UploadDetection }>("/api/imports/detect", {
    filename: file.name,
    content: file.content,
    encoding: file.encoding,
    casPassword: password || undefined,
  });
  return res.detection;
}

export function AddData() {
  const { pending, take } = useDropFiles();
  const qc = useQueryClient();
  const [items, setItems] = useState<Item[]>([]);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [skipped, setSkipped] = useState<string[]>([]);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<CommitManyResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setResult(null);
    const { loaded, skipped: sk } = await loadFiles(files);
    if (sk.length) setSkipped((s) => [...s, ...sk.map((x) => `${x.name}: ${x.why}`)]);
    const fresh: Item[] = loaded.map((file) => ({ file, status: "detecting", detection: null, include: true, password: "" }));
    setItems((prev) => [...prev, ...fresh]);
    // Identify three at a time so a big drop stays responsive.
    let next = 0;
    const worker = async () => {
      while (next < fresh.length) {
        const it = fresh[next++]!;
        let detection: UploadDetection;
        try {
          detection = await detectOne(it.file);
        } catch (e) {
          detection = unreadable(it.file.name, e instanceof ApiError ? e.message : "Couldn't read this file");
        }
        setItems((prev) =>
          prev.map((p) =>
            p.file.id === it.file.id
              ? { ...p, status: "ready", detection, include: detection.kind === "transactions" ? (detection.counts?.toImport ?? 0) > 0 : detection.kind === "prices" || detection.kind === "pnl_report" }
              : p,
          ),
        );
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  };

  // Files dropped anywhere in the app arrive here.
  useEffect(() => {
    if (pending.length) void addFiles(take());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const ready = items.filter((i) => i.status === "ready");
  const groups = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const it of ready.filter(needsAccount)) {
      const k = groupKeyFor(it, ready);
      map.set(k, [...(map.get(k) ?? []), it]);
    }
    return [...map.entries()].map(([key, members]) => ({ key, members }));
  }, [ready]);

  // Pre-fill answers from the server's suggestions (a known client code, or your only account there).
  useEffect(() => {
    setAnswers((prev) => {
      const next = { ...prev };
      for (const g of groups) {
        if (next[g.key]) continue;
        const s = g.members.map((m) => m.detection!.suggestion).find(Boolean);
        if (s) next[g.key] = { mode: "existing", accountId: s.accountId, adoptRef: s.adoptRef };
      }
      return next;
    });
  }, [groups]);

  /**
   * Record one group's answer. A new person's name typed in one question carries over to the other
   * questions still mirroring it, so a drop of Dad's three brokers means typing "Dad" once.
   */
  const answer = (key: string, a: Answer) =>
    setAnswers((p) => {
      const next = { ...p, [key]: a };
      const prev = p[key];
      if (a.mode === "new" && a.ownerId === "__new" && prev?.mode === "new" && prev.ownerId === "__new" && prev.newOwnerName !== a.newOwnerName) {
        for (const [k, o] of Object.entries(next)) {
          if (k !== key && o.mode === "new" && o.ownerId === "__new" && o.newOwnerName === prev.newOwnerName) next[k] = { ...o, newOwnerName: a.newOwnerName };
        }
      }
      return next;
    });

  const complete = (a: Answer | undefined) =>
    !!a && (a.mode === "existing" ? !!a.accountId : (a.ownerId !== "__new" || a.newOwnerName.trim().length > 0) && !!a.ownerId && a.accountName.trim().length > 0);
  const unanswered = groups.filter((g) => !complete(answers[g.key]));
  const importable = ready.filter(willImport);
  const detecting = items.some((i) => i.status === "detecting");
  const newRows = importable.reduce((n, i) => n + (i.detection?.counts?.toImport ?? 0), 0);

  const commit = async () => {
    setCommitting(true);
    try {
      const payload: CommitManyItem[] = [];
      for (const it of importable) {
        const d = it.detection!;
        if (d.kind === "prices") {
          payload.push({ filename: it.file.name, content: it.file.content, encoding: it.file.encoding, kind: "prices" });
          continue;
        }
        const key = groupKeyFor(it, ready);
        const a = answers[key]!;
        const target: CommitTarget =
          a.mode === "existing"
            ? { accountId: a.accountId, adoptRef: a.adoptRef }
            : {
                newAccount: {
                  ...(a.ownerId === "__new" ? { newPortfolioName: a.newOwnerName.trim() } : { portfolioId: a.ownerId }),
                  broker: a.broker,
                  accountRef: a.accountRef,
                  name: a.accountName.trim(),
                  currency: a.currency,
                },
              };
        payload.push(
          d.kind === "pnl_report"
            ? { filename: it.file.name, content: it.file.content, encoding: it.file.encoding, kind: "pnl_report", target }
            : { filename: it.file.name, content: it.file.content, encoding: it.file.encoding, casPassword: it.password || undefined, kind: "transactions", adapter: d.adapter!, target },
        );
      }
      const res = await api.post<CommitManyResult>("/api/imports/commit-many", { items: payload });
      setResult(res);
      setItems([]);
      setAnswers({});
      setSkipped([]);
      await qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "The import didn't go through. Nothing was changed.");
    } finally {
      setCommitting(false);
    }
  };

  const retryWithPassword = async (it: Item) => {
    setItems((prev) => prev.map((p) => (p.file.id === it.file.id ? { ...p, status: "detecting" } : p)));
    const detection = await detectOne(it.file, it.password).catch(() => unreadable(it.file.name, "Couldn't read this file"));
    setItems((prev) => prev.map((p) => (p.file.id === it.file.id ? { ...p, status: "ready", detection, include: detection.kind === "transactions" } : p)));
    if (detection.kind === "needs_password") toast.error("That password didn't open the statement.");
  };

  if (result) return <Done result={result} onMore={() => setResult(null)} />;

  return (
    <div className="space-y-6 pb-28">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".csv,.xlsx,.xls,.pdf,.zip,.txt"
        className="hidden"
        onChange={(e) => {
          void addFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />

      <DropZone compact={items.length > 0} onChoose={() => inputRef.current?.click()} />

      {skipped.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Skipped: {skipped.join(" · ")}
        </p>
      )}

      {groups.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            {unanswered.length > 0 ? `${unanswered.length} quick question${unanswered.length === 1 ? "" : "s"}` : "Accounts"}
          </h2>
          {groups.map((g) => (
            <AccountQuestion key={g.key} members={g.members} answer={answers[g.key]} onAnswer={(a) => answer(g.key, a)} />
          ))}
        </section>
      )}

      {items.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Files</h2>
          <AnimatePresence initial={false}>
            {items.map((it, i) => (
              <FileCard
                key={it.file.id}
                item={it}
                index={i}
                onToggle={() => setItems((p) => p.map((x) => (x.file.id === it.file.id ? { ...x, include: !x.include } : x)))}
                onRemove={() => setItems((p) => p.filter((x) => x.file.id !== it.file.id))}
                onPassword={(pw) => setItems((p) => p.map((x) => (x.file.id === it.file.id ? { ...x, password: pw } : x)))}
                onRetry={() => void retryWithPassword(it)}
              />
            ))}
          </AnimatePresence>
        </section>
      )}

      <AnimatePresence>
        {items.length > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
            className="fixed inset-x-0 bottom-5 z-30 px-4"
          >
            <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 rounded-full border bg-popover py-2.5 pr-2.5 pl-6">
              <p className="text-sm">
                {detecting ? (
                  <span className="text-muted-foreground">Reading your files…</span>
                ) : importable.length === 0 ? (
                  <span className="text-muted-foreground">Nothing new to import.</span>
                ) : unanswered.length > 0 ? (
                  <span className="text-warning">Answer {unanswered.length === 1 ? "the question" : `${unanswered.length} questions`} above to continue</span>
                ) : (
                  <span>
                    <b>{importable.length}</b> file{importable.length === 1 ? "" : "s"}
                    {newRows > 0 && (
                      <span className="text-muted-foreground"> · {newRows.toLocaleString("en-IN")} new entries</span>
                    )}
                  </span>
                )}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setItems([]); setAnswers({}); setSkipped([]); }}>
                  Clear
                </Button>
                <Button disabled={detecting || committing || importable.length === 0 || unanswered.length > 0} onClick={() => void commit()}>
                  {committing ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Import
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function unreadable(filename: string, message: string): UploadDetection {
  return { filename, kind: "unrecognized", snapshot: false, adapter: null, confidence: 0, reason: message, brokerFamily: null, accountRef: null, holderName: null, sheet: null, counts: null, priceRows: null, currency: null, suggestion: null, error: message };
}

function DropZone({ compact, onChoose }: { compact: boolean; onChoose: () => void }) {
  return (
    <section className={cn("rounded-[28px] border-2 border-dashed bg-card/70 text-center transition-all duration-300", compact ? "px-6 py-6" : "px-6 py-14")}>
      <div className={cn("mx-auto flex items-center gap-5", compact ? "flex-col text-center sm:flex-row sm:text-left" : "max-w-xl flex-col")}>
        <span className={cn("grid shrink-0 place-items-center rounded-full bg-primary text-primary-foreground", compact ? "size-12" : "size-16")}>
          <Upload className={compact ? "size-5" : "size-7"} />
        </span>
        <div className="flex-1">
          <p className={cn("font-display", compact ? "text-2xl" : "text-4xl")}>{compact ? "Add more files" : "Drop your files anywhere"}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {compact
              ? "Or drag them anywhere on the page."
              : "Broker exports (CSV or Excel), mutual fund CAS PDFs, or a ZIP of them all. Dhan Drishti works out what each one is."}
          </p>
        </div>
        <div className={cn("flex items-center gap-2", !compact && "mt-2")}>
          <Button onClick={onChoose}>
            <Upload /> Choose files
          </Button>
          <HelpSheet />
        </div>
      </div>
    </section>
  );
}

function HelpSheet() {
  const shown = ["zerodha", "zerodha-holdings", "dhan-txn", "dhan-holdings", "vested", "cas", "ibkr", "binance"] as const;
  const titles: Record<(typeof shown)[number], string> = {
    zerodha: "Zerodha trades",
    "zerodha-holdings": "Zerodha holdings",
    "dhan-txn": "Dhan transactions",
    "dhan-holdings": "Dhan holdings (prices)",
    vested: "Vested (US stocks)",
    cas: "Mutual funds (CAS)",
    ibkr: "Interactive Brokers",
    binance: "Binance",
  };
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">
          <HelpCircle /> Where do I get these?
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="font-display text-3xl font-normal">Getting your files</SheetTitle>
          <SheetDescription>Download these from each broker, then drop them all in at once.</SheetDescription>
        </SheetHeader>
        <div className="space-y-5 px-4 pb-8">
          {shown.map((k) => {
            const g = GUIDES[k];
            if (!g) return null;
            return (
              <div key={k} className="rounded-2xl border bg-card p-4">
                <p className="font-semibold">{titles[k]}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{g.where}</p>
                <ol className="mt-3 ml-4 list-decimal space-y-1 text-sm text-muted-foreground">
                  {g.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
                {g.note && <p className="mt-2 text-xs text-muted-foreground">{g.note}</p>}
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function verdict(it: Item): { label: string; tone: "gain" | "muted" | "warning" | "loss"; icon: ReactNode } {
  const d = it.detection;
  if (!d) return { label: "Reading…", tone: "muted", icon: <Loader2 className="animate-spin" /> };
  switch (d.kind) {
    case "transactions":
      if ((d.counts?.toImport ?? 0) === 0) return { label: "Already imported", tone: "muted", icon: <CheckCircle2 /> };
      if (d.snapshot) return { label: it.include ? "Balances" : "Skipped", tone: it.include ? "gain" : "muted", icon: <Layers /> };
      return { label: it.include ? "Will import" : "Skipped", tone: it.include ? "gain" : "muted", icon: <FileSpreadsheet /> };
    case "prices":
      return { label: it.include ? "Prices only" : "Skipped", tone: it.include ? "gain" : "muted", icon: <Tags /> };
    case "pnl_report":
      return { label: it.include ? "Double-checks" : "Skipped", tone: it.include ? "gain" : "muted", icon: <ShieldCheck /> };
    case "not_needed":
      return { label: "Not needed", tone: "muted", icon: <CircleSlash /> };
    case "needs_password":
      return { label: "Needs password", tone: "warning", icon: <KeyRound /> };
    default:
      return { label: "Not recognised", tone: "loss", icon: <FileQuestion /> };
  }
}

function FileCard({
  item,
  index,
  onToggle,
  onRemove,
  onPassword,
  onRetry,
}: {
  item: Item;
  index: number;
  onToggle: () => void;
  onRemove: () => void;
  onPassword: (pw: string) => void;
  onRetry: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const d = item.detection;
  const v = verdict(item);
  const c = d?.counts;
  const toggleable = d && ((d.kind === "transactions" && (c?.toImport ?? 0) > 0) || d.kind === "prices" || d.kind === "pnl_report");
  const what = !d
    ? "Working out what this is"
    : d.kind === "transactions" || d.kind === "prices" || d.kind === "pnl_report"
      ? [brokerName(d.brokerFamily), d.accountRef, c?.period ? `${dateShort(c.period.from)} – ${dateShort(c.period.to)}` : null].filter(Boolean).join(" · ")
      : d.reason;
  return (
    <motion.article
      layout={!reduceMotion}
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ delay: Math.min(index * 0.04, 0.3), duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className={cn("rounded-2xl border bg-card p-4 transition-opacity", d && !item.include && toggleable && "opacity-60")}
    >
      <div className="flex items-start gap-4">
        <span className={cn("mt-0.5 grid size-10 shrink-0 place-items-center rounded-full bg-raised [&_svg]:size-5", v.tone === "gain" && "text-gain", v.tone === "warning" && "text-warning", v.tone === "loss" && "text-loss", v.tone === "muted" && "text-muted-foreground")}>
          {v.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-semibold">{item.file.name}</p>
            <Badge variant={v.tone === "gain" ? "gain" : v.tone === "warning" ? "warning" : v.tone === "loss" ? "loss" : "muted"}>{v.label}</Badge>
          </div>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">{what}</p>
          {d?.kind === "transactions" && d.snapshot && c && (
            <p className="mt-2 text-sm text-muted-foreground">
              <b className="text-foreground">{c.valid.toLocaleString("en-IN")}</b> positions. Checked against this account's trades: only shares they don't already show are added, never twice.
            </p>
          )}
          {d?.kind === "transactions" && !d.snapshot && c && (
            <p className="mt-2 text-sm">
              <b>{c.toImport.toLocaleString("en-IN")}</b> new
              {c.duplicates > 0 && <span className="text-muted-foreground"> · {c.duplicates.toLocaleString("en-IN")} already in your ledger</span>}
              {c.invalid > 0 && <span className="text-warning"> · {c.invalid} row{c.invalid === 1 ? "" : "s"} unreadable</span>}
              {c.newSecurities > 0 && <span className="text-muted-foreground"> · {c.newSecurities} new holdings</span>}
            </p>
          )}
          {d?.kind === "prices" && <p className="mt-2 text-sm text-muted-foreground">Updates the price of {d.priceRows ?? 0} holdings. No trades are added.</p>}
          {d?.kind === "pnl_report" && (
            <p className="mt-2 text-sm text-muted-foreground">Your broker's own profit report. Used to double-check the numbers and fill in any closing trade the statement missed.</p>
          )}
          {d?.kind === "unrecognized" && (
            <p className="mt-2 text-sm text-muted-foreground">
              You can still bring it in by matching its columns yourself in{" "}
              <Link to="/accounts/manual" className="text-foreground underline-offset-4 hover:underline">
                manual import
              </Link>
              .
            </p>
          )}
          {d?.kind === "needs_password" && (
            <form
              className="mt-3 flex max-w-sm gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                onRetry();
              }}
            >
              <Input type="password" placeholder="Statement password (often your PAN)" value={item.password} onChange={(e) => onPassword(e.target.value)} className="h-9 rounded-full" autoComplete="off" />
              <Button type="submit" size="sm" disabled={!item.password}>
                Open
              </Button>
            </form>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {toggleable && (
            <Button variant="ghost" size="sm" onClick={onToggle} aria-pressed={item.include}>
              {item.include ? "Skip" : "Include"}
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" onClick={onRemove} aria-label={`Remove ${item.file.name}`}>
            <X />
          </Button>
        </div>
      </div>
    </motion.article>
  );
}

function AccountQuestion({ members, answer, onAnswer }: { members: Item[]; answer: Answer | undefined; onAnswer: (a: Answer) => void }) {
  const { data: accounts } = useAllAccounts();
  const { data: portfolios } = usePortfolios();
  const d = members.find((m) => m.detection?.accountRef)?.detection ?? members[0]!.detection!;
  const family = members.map((m) => m.detection?.brokerFamily).find(Boolean) ?? null;
  const ref = d.accountRef;
  const holder = members.map((m) => m.detection?.holderName).find(Boolean) ?? null;
  const currency = members.map((m) => m.detection?.currency).find(Boolean) ?? "INR";
  const suggestion = members.map((m) => m.detection?.suggestion).find(Boolean) ?? null;
  const candidates = (accounts ?? []).filter((a) => !family || a.broker === family);
  const portfolioName = (id: string) => portfolios?.find((p) => p.id === id)?.name ?? "";
  const defaultName = [brokerName(family), ref].filter(Boolean).join(" · ");
  const mode = answer?.mode ?? (candidates.length > 0 ? "existing" : "new");
  const title = ref ? `Whose ${brokerName(family)} account is ${ref}?` : `Which account are ${members.length === 1 ? "this file's" : "these files'"} entries from?`;

  // People load after the question first renders; don't leave it on "Someone new" when there's
  // already a person to pick (that would block Import until a name is typed).
  const ownerDefaulted = useRef(false);
  useEffect(() => {
    if (ownerDefaulted.current || !portfolios || !answer) return;
    ownerDefaulted.current = true; // only the first default; a deliberate "Someone new" stays
    if (answer.mode === "new" && answer.ownerId === "__new" && !answer.newOwnerName.trim() && portfolios.length) {
      onAnswer({ ...answer, ownerId: portfolios[0]!.id });
    }
  }, [answer, portfolios, onAnswer]);

  const startNew = (): Extract<Answer, { mode: "new" }> => ({
    mode: "new",
    ownerId: portfolios?.[0]?.id ?? "__new",
    newOwnerName: holder ? toTitle(holder) : "",
    accountName: defaultName,
    broker: family ?? "generic",
    accountRef: ref,
    currency,
  });

  return (
    <motion.div layout className={cn("rounded-2xl border bg-card p-5", !answer && "border-warning/50")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{title}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {members.length} file{members.length === 1 ? "" : "s"}
            {holder && <> · name on the file: {toTitle(holder)}</>}
            {suggestion && answer?.mode === "existing" && answer.accountId === suggestion.accountId && <> · matched by {suggestion.why.toLowerCase()}</>}
          </p>
        </div>
        {candidates.length > 0 && (
          <Segmented
            ariaLabel="Existing or new account"
            size="xs"
            value={mode}
            onChange={(m) => onAnswer(m === "existing" ? { mode: "existing", accountId: suggestion?.accountId ?? candidates[0]!.id, adoptRef: suggestion?.adoptRef ?? (ref ?? null) } : startNew())}
            options={[
              { value: "existing", label: "Existing account" },
              { value: "new", label: "New account" },
            ]}
          />
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {mode === "existing" ? (
          <label className="block space-y-1.5 sm:col-span-2">
            <span className="text-sm text-muted-foreground">Account</span>
            <select
              className="h-10 w-full cursor-pointer rounded-xl border border-input bg-background px-3.5 text-sm"
              value={answer?.mode === "existing" ? answer.accountId : ""}
              onChange={(e) => onAnswer({ mode: "existing", accountId: e.target.value, adoptRef: ref })}
            >
              <option value="" disabled>
                Choose an account
              </option>
              {candidates.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} — {portfolioName(a.portfolioId)}
                  {a.accountRef ? ` (${a.accountRef})` : ""}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <NewAccountFields answer={answer?.mode === "new" ? answer : startNew()} onAnswer={onAnswer} portfolios={portfolios ?? []} />
        )}
      </div>
    </motion.div>
  );
}

function NewAccountFields({ answer, onAnswer, portfolios }: { answer: Extract<Answer, { mode: "new" }>; onAnswer: (a: Answer) => void; portfolios: { id: string; name: string }[] }) {
  // Commit the default the first time this renders so the question counts as answered.
  const seeded = useRef(false);
  useEffect(() => {
    if (!seeded.current) {
      seeded.current = true;
      onAnswer(answer);
    }
  }, [answer, onAnswer]);
  const set = (patch: Partial<Extract<Answer, { mode: "new" }>>) => onAnswer({ ...answer, ...patch });
  return (
    <>
      <label className="block space-y-1.5">
        <span className="text-sm text-muted-foreground">Whose money</span>
        <select className="h-10 w-full cursor-pointer rounded-xl border border-input bg-background px-3.5 text-sm" value={answer.ownerId} onChange={(e) => set({ ownerId: e.target.value })}>
          {portfolios.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value="__new">Someone new…</option>
        </select>
      </label>
      {answer.ownerId === "__new" ? (
        <label className="block space-y-1.5">
          <span className="text-sm text-muted-foreground">Their name</span>
          <Input className="h-10 rounded-xl" value={answer.newOwnerName} onChange={(e) => set({ newOwnerName: e.target.value })} placeholder="e.g. Dad" />
        </label>
      ) : (
        <label className="block space-y-1.5">
          <span className="text-sm text-muted-foreground">Call this account</span>
          <Input className="h-10 rounded-xl" value={answer.accountName} onChange={(e) => set({ accountName: e.target.value })} />
        </label>
      )}
    </>
  );
}

function toTitle(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function Done({ result, onMore }: { result: CommitManyResult; onMore: () => void }) {
  const navigate = useNavigate();
  const { data: accounts } = useAllAccounts();
  const brokerOf = (accountId: string | null) => brokerName(accounts?.find((a) => a.id === accountId)?.broker);
  const checks = result.files.filter((f) => f.reconcile);
  const statements = result.files.filter((f) => f.snapshot && f.snapshot.notInStatement.length > 0);
  const imported = result.files.reduce((n, f) => n + f.imported, 0);
  const priced = result.files.reduce((n, f) => n + (f.prices?.seeded ?? 0), 0);
  const before = Number(result.before.netWorth);
  const after = Number(result.after.netWorth);
  const delta = after - before;
  const newPositions = result.after.openPositions - result.before.openPositions;
  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mx-auto max-w-3xl space-y-6">
      <div className="rounded-[28px] border bg-card p-8 text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-gain/15 text-gain">
          <CheckCircle2 className="size-7" />
        </span>
        <p className="mt-5 font-display text-4xl">Imported</p>
        <p className="mt-1 text-muted-foreground">
          {imported.toLocaleString("en-IN")} new entr{imported === 1 ? "y" : "ies"}
          {priced > 0 && ` · ${priced} prices updated`}
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <Tile label="Net worth now">
            <CountUp from={before} to={after} format={(n) => compactMoney(n)} />
          </Tile>
          <Tile label="Change" tone={delta >= 0 ? "gain" : "loss"}>
            {signedMoney(delta)}
          </Tile>
          <Tile label="Open positions">
            {result.after.openPositions}
            {newPositions !== 0 && <span className="ml-1 text-base text-muted-foreground">({newPositions > 0 ? "+" : ""}{newPositions})</span>}
          </Tile>
        </div>
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          <Button size="lg" onClick={() => navigate("/")}>
            See where you stand <ArrowRight />
          </Button>
          <Button size="lg" variant="outline" onClick={onMore}>
            <RotateCcw /> Add more files
          </Button>
        </div>
      </div>
      {statements.map((f) => (
        <NotInStatement key={f.filename} broker={brokerOf(f.accountId)} filename={f.filename} s={f.snapshot!} />
      ))}
      {checks.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Checked against your broker</h2>
          {checks.map((f) => (
            <BrokerCheck key={f.filename} broker={brokerOf(f.accountId)} filename={f.filename} r={f.reconcile!} />
          ))}
        </section>
      )}
      <ul className="space-y-2 text-sm">
        {result.files.map((f) => (
          <li key={f.filename} className="flex items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-3">
            <span className="truncate">{f.filename}</span>
            <span className="shrink-0 text-muted-foreground">
              {f.kind === "prices"
                ? `${f.prices?.seeded ?? 0} prices`
                : f.snapshot
                  ? statementLine(f.snapshot)
                : f.kind === "pnl_report"
                  ? f.imported > 0
                    ? `checked · ${f.imported} missing trade${f.imported === 1 ? "" : "s"} filled`
                    : "checked"
                  : `${f.imported} added${f.duplicates ? ` · ${f.duplicates} already there` : ""}${f.replaced ? ` · ${f.replaced} replaced` : ""}`}
            </span>
          </li>
        ))}
      </ul>
    </motion.section>
  );
}

function Tile({ label, children, tone }: { label: string; children: ReactNode; tone?: "gain" | "loss" }) {
  return (
    <div className="rounded-2xl border bg-raised/50 p-4">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className={cn("mt-1.5 text-2xl font-semibold", tone === "gain" && "text-gain", tone === "loss" && "text-loss")}>{children}</p>
    </div>
  );
}

/**
 * One P&L report's verdict, in plain words: does our number agree with the broker's, and if not,
 * the likely reason. Close enough is within ₹500 or 0.25% — charges are rounded on their side.
 */
function BrokerCheck({ broker, filename, r }: { broker: string; filename: string; r: PnlReconcile }) {
  const [open, setOpen] = useState(false);
  const c = r.check;
  const diff = c ? Math.abs(Number(c.difference)) : 0;
  const agrees = !!c && diff <= Math.max(500, Math.abs(Number(c.broker)) * 0.0025);
  const period = c ? `${dateShort(c.from)} – ${dateShort(c.to)}` : null;
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="flex items-start gap-4">
        <span className={cn("mt-0.5 grid size-10 shrink-0 place-items-center rounded-full bg-raised [&_svg]:size-5", agrees ? "text-gain" : "text-warning")}>
          {agrees || !c ? <ShieldCheck /> : <Scale />}
        </span>
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold">
            {!c ? `${broker}'s report` : agrees ? `Matches ${broker}'s own profit report` : `${broker}'s report and ours differ by ${compactMoney(diff)}`}
          </p>
          <p className="mt-0.5 truncate text-muted-foreground">
            {filename}
            {period && <> · {period}</>}
          </p>
          {c && (
            <p className="mt-2">
              {broker}: <b className={Number(c.broker) >= 0 ? "text-gain" : "text-loss"}>{signedMoney(c.broker, "INR", false)}</b>
              <span className="text-muted-foreground"> · </span>
              Dhan Drishti: <b className={Number(c.ours) >= 0 ? "text-gain" : "text-loss"}>{signedMoney(c.ours, "INR", false)}</b>
            </p>
          )}
          {c && !agrees && (
            <p className="mt-1.5 text-muted-foreground">
              {c.soldWithoutPurchase > 0
                ? `${c.soldWithoutPurchase} holding${c.soldWithoutPurchase === 1 ? " was" : "s were"} sold that ${c.soldWithoutPurchase === 1 ? "was" : "were"} bought before ${dateShort(c.from)}. ${broker} knows what you paid; these files don't. Add a statement from before then and the two will line up.`
                : "Brokers sometimes count charges or corporate actions differently. Your trades are all here; only the totals differ."}
            </p>
          )}
          {r.filled.length > 0 && (
            <div className="mt-2">
              <button type="button" className="text-left text-foreground underline-offset-4 hover:underline" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
                Added {r.filled.length} closing trade{r.filled.length === 1 ? "" : "s"} the statement left out
              </button>
              <AnimatePresence initial={false}>
                {open && (
                  <motion.ul
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden"
                  >
                    {r.filled.map((t) => (
                      <li key={`${t.contract}|${t.type}`} className="mt-1.5 flex flex-wrap gap-x-2 text-muted-foreground">
                        <span className="text-foreground">{t.contract}</span>
                        <span>
                          {t.type === "sell" ? "sold" : "bought back"} {Number(t.quantity).toLocaleString("en-IN")} @ ₹{Number(t.price).toLocaleString("en-IN")} · by {dateShort(t.tradeDate)}
                        </span>
                      </li>
                    ))}
                  </motion.ul>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function statementLine(s: NonNullable<CommitManyResult["files"][number]["snapshot"]>): string {
  const parts = [
    s.opening > 0 && `${s.opening} opening balance${s.opening === 1 ? "" : "s"}`,
    s.reduced > 0 && `${s.reduced} reduced`,
  ].filter(Boolean);
  return parts.length ? `balances · ${parts.join(" · ")}` : "balances · matches your trades";
}

/** Positions the trades say are held that the broker's statement doesn't list — likely sold since. */
function NotInStatement({ broker, filename, s }: { broker: string; filename: string; s: NonNullable<CommitManyResult["files"][number]["snapshot"]> }) {
  const shown = s.notInStatement.slice(0, 8);
  const more = s.notInStatement.length - shown.length;
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="flex items-start gap-4">
        <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-full bg-raised text-warning [&_svg]:size-5">
          <Layers />
        </span>
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold">
            {s.notInStatement.length} holding{s.notInStatement.length === 1 ? "" : "s"} from your trades {s.notInStatement.length === 1 ? "isn't" : "aren't"} on {broker}'s statement
          </p>
          <p className="mt-0.5 truncate text-muted-foreground">
            {filename} · as of {dateShort(s.asOf)}
          </p>
          <p className="mt-2">
            {shown.join(", ")}
            {more > 0 && <span className="text-muted-foreground"> and {more} more</span>}
          </p>
          <p className="mt-1.5 text-muted-foreground">
            They were most likely sold after your trade files end. Add the newer tradebook and they'll close on their own; until then they still count as held.
          </p>
        </div>
      </div>
    </div>
  );
}
