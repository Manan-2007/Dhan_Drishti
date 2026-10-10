import { useState, type FormEvent, type ReactNode } from "react";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import { Check, Pencil, Plus, Trash2, UserPlus, X } from "lucide-react";
import { Empty } from "@/components/kit/Empty";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, ApiError, type Account, type Portfolio } from "@/lib/api";
import { useAllAccounts, useHoldings, useImports, usePortfolios } from "@/lib/hooks";
import { ago, compactMoney } from "@/lib/format";
import { BROKER_CHOICES, brokerLabel, isPersonal } from "@/lib/brokers";
import { cn } from "@/lib/utils";

const BROKERS: { id: string; label: string }[] = [...BROKER_CHOICES.map(({ id, label }) => ({ id, label })), { id: "manual", label: "Entered by hand" }];

function useRefresh() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries();
}

/** Whose money it is, and the broker accounts under each person. */
export function People() {
  const { data: people, isLoading } = usePortfolios();
  const { data: accounts } = useAllAccounts();
  const { data: imports } = useImports();
  const refresh = useRefresh();
  const [adding, setAdding] = useState(false);

  const addPerson = useMutation({
    mutationFn: (name: string) => api.post("/api/portfolios", { name, kind: "family" }),
    onSuccess: () => {
      setAdding(false);
      refresh();
      toast.success("Added");
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't add"),
  });

  if (isLoading) return <Skeleton className="h-72 rounded-2xl" />;
  if (!people || people.length === 0) {
    return <Empty title="No one yet" body="Add the person whose money this is — or just drop broker files on the Add data tab and answer one question." action={<Button onClick={() => setAdding(true)}><UserPlus /> Add a person</Button>} />;
  }

  // When each account last got new files.
  const lastImport = new Map<string, string>();
  for (const b of imports ?? []) if (b.accountId && (!lastImport.has(b.accountId) || b.createdAt > lastImport.get(b.accountId)!)) lastImport.set(b.accountId, b.createdAt);

  // Personal use: one person — so this page is about your brokers, not family members.
  if (isPersonal(people)) {
    const me = people[0]!;
    const mine = (accounts ?? []).filter((a) => a.portfolioId === me.id);
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Your broker accounts. Each broker's files land in its own account, and every page can show them together or one at a time.</p>
        <PersonCard person={me} index={0} accounts={mine} lastImport={lastImport} />
        <AddBrokers portfolioId={me.id} have={new Set(mine.map((a) => a.broker))} />
        <p className="text-sm text-muted-foreground">
          Tracking family money too?{" "}
          <button type="button" className="cursor-pointer text-foreground underline-offset-4 hover:underline" onClick={() => setAdding(true)}>
            Add a person
          </button>
        </p>
        <NameDialog open={adding} onOpenChange={setAdding} title="Add a person" placeholder="e.g. Dad" busy={addPerson.isPending} onSave={(n) => addPerson.mutate(n)} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Each person's money, and the broker accounts it sits in. Imports add accounts on their own.</p>
        <Button variant="outline" onClick={() => setAdding(true)}>
          <UserPlus /> Add a person
        </Button>
      </div>

      {people.map((p, i) => (
        <PersonCard key={p.id} person={p} index={i} accounts={(accounts ?? []).filter((a) => a.portfolioId === p.id)} lastImport={lastImport} />
      ))}

      <NameDialog open={adding} onOpenChange={setAdding} title="Add a person" placeholder="e.g. Dad" busy={addPerson.isPending} onSave={(n) => addPerson.mutate(n)} />
    </div>
  );
}

/** One tap adds an account at a broker you don't have yet. */
function AddBrokers({ portfolioId, have }: { portfolioId: string; have: Set<string> }) {
  const refresh = useRefresh();
  const add = useMutation({
    mutationFn: (broker: string) => api.post("/api/accounts", { portfolioId, name: brokerLabel(broker), broker }),
    onSuccess: (_d, broker) => {
      refresh();
      toast.success(`${brokerLabel(broker)} added`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't add"),
  });
  const missing = BROKER_CHOICES.filter((b) => !have.has(b.id));
  if (missing.length === 0) return null;
  return (
    <section className="rounded-2xl border bg-card p-5">
      <p className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Add a broker</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {missing.map((b) => (
          <button
            key={b.id}
            type="button"
            disabled={add.isPending}
            onClick={() => add.mutate(b.id)}
            className="flex cursor-pointer items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground disabled:opacity-50"
          >
            <Plus className="size-3.5" />
            {b.label}
            {b.hint && <span className="text-xs opacity-70">· {b.hint}</span>}
          </button>
        ))}
      </div>
    </section>
  );
}

function PersonCard({ person, index, accounts, lastImport }: { person: Portfolio; index: number; accounts: Account[]; lastImport: Map<string, string> }) {
  const { data: holdings } = useHoldings(person.id);
  const refresh = useRefresh();
  const reduceMotion = useReducedMotion();
  const [renaming, setRenaming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [addingAccount, setAddingAccount] = useState(false);

  const rename = useMutation({
    mutationFn: (name: string) => api.put(`/api/portfolios/${person.id}`, { name }),
    onSuccess: () => {
      setRenaming(false);
      refresh();
    },
    onError: () => toast.error("Couldn't rename"),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/api/portfolios/${person.id}`),
    onSuccess: () => {
      setRemoving(false);
      refresh();
      toast.success(`${person.name} removed`);
    },
    onError: () => toast.error("Couldn't remove"),
  });

  return (
    <motion.section
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3 }}
      className="rounded-2xl border bg-card p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-full bg-primary font-display text-xl text-primary-foreground">{person.name.slice(0, 1).toUpperCase()}</span>
          <div>
            <p className="font-display text-3xl leading-none">{person.name}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {holdings ? `${compactMoney(holdings.summary.netWorth, holdings.baseCurrency)} · ${holdings.summary.openPositions} holdings` : "…"} · {accounts.length} account{accounts.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setRenaming(true)}>
            <Pencil /> Rename
          </Button>
          <Button variant="ghost" size="sm" className="text-loss hover:text-loss" onClick={() => setRemoving(true)}>
            <Trash2 /> Remove
          </Button>
        </div>
      </div>

      <ul className="mt-4 divide-y rounded-xl border">
        {accounts.map((a) => (
          <AccountRow key={a.id} account={a} last={lastImport.get(a.id) ?? null} />
        ))}
        <li>
          <button type="button" onClick={() => setAddingAccount(true)} className="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-sm text-muted-foreground transition-colors hover:bg-raised/60 hover:text-foreground">
            <Plus className="size-4" /> Add an account by hand
          </button>
        </li>
      </ul>

      <NameDialog open={renaming} onOpenChange={setRenaming} title="Rename" initial={person.name} busy={rename.isPending} onSave={(n) => rename.mutate(n)} />
      <Confirm
        open={removing}
        onOpenChange={setRemoving}
        title={`Remove ${person.name}?`}
        body={`This deletes ${person.name}'s accounts and every trade, dividend and statement under them. It can't be undone. The files you imported stay on your computer, so you can drop them in again later.`}
        confirm="Remove everything"
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
      <AccountDialog open={addingAccount} onOpenChange={setAddingAccount} portfolioId={person.id} />
    </motion.section>
  );
}

function AccountRow({ account, last }: { account: Account; last: string | null }) {
  const refresh = useRefresh();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(account.name);
  const [removing, setRemoving] = useState(false);
  const save = useMutation({
    mutationFn: () => api.put(`/api/accounts/${account.id}`, { name: name.trim() }),
    onSuccess: () => {
      setEditing(false);
      refresh();
    },
    onError: () => toast.error("Couldn't rename"),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/api/accounts/${account.id}`),
    onSuccess: () => {
      setRemoving(false);
      refresh();
    },
    onError: () => toast.error("Couldn't remove"),
  });
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-raised text-sm font-semibold">{brokerLabel(account.broker).slice(0, 1)}</span>
      <div className="min-w-0 flex-1">
        {editing ? (
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) save.mutate();
            }}
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 max-w-64 rounded-full" autoFocus aria-label="Account name" />
            <Button type="submit" size="icon-sm" aria-label="Save">
              <Check />
            </Button>
            <Button type="button" size="icon-sm" variant="ghost" onClick={() => setEditing(false)} aria-label="Cancel">
              <X />
            </Button>
          </form>
        ) : (
          <p className="truncate font-semibold">{account.name}</p>
        )}
        <p className="text-xs text-muted-foreground">
          {[brokerLabel(account.broker), account.accountRef && `client code ${account.accountRef}`, account.currency !== "INR" && account.currency, last ? `files added ${ago(last)}` : "no files yet"].filter(Boolean).join(" · ")}
        </p>
      </div>
      {!editing && (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => setEditing(true)} aria-label={`Rename ${account.name}`}>
            <Pencil />
          </Button>
          <Button variant="ghost" size="icon-sm" className="text-loss hover:text-loss" onClick={() => setRemoving(true)} aria-label={`Remove ${account.name}`}>
            <Trash2 />
          </Button>
        </div>
      )}
      <Confirm
        open={removing}
        onOpenChange={setRemoving}
        title={`Remove ${account.name}?`}
        body="Its trades stay in the ledger but lose their account, and its holdings statement goes. To take the trades out too, remove them from Activity first."
        confirm="Remove account"
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </li>
  );
}

function NameDialog({ open, onOpenChange, title, initial = "", placeholder, busy, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; initial?: string; placeholder?: string; busy: boolean; onSave: (name: string) => void }) {
  const [name, setName] = useState(initial);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) onSave(name.trim());
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setName(initial);
        onOpenChange(o);
      }}
    >
      <DialogContent className="rounded-2xl sm:max-w-sm">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-normal">{title}</DialogTitle>
          </DialogHeader>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} className="h-10 rounded-xl" autoFocus aria-label="Name" />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy || !name.trim()}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AccountDialog({ open, onOpenChange, portfolioId }: { open: boolean; onOpenChange: (o: boolean) => void; portfolioId: string }) {
  const refresh = useRefresh();
  const [broker, setBroker] = useState("zerodha");
  const [name, setName] = useState("");
  const [ref, setRef] = useState("");
  const create = useMutation({
    mutationFn: () => api.post("/api/accounts", { portfolioId, broker, name: name.trim() || brokerLabel(broker), accountRef: ref.trim() || undefined }),
    onSuccess: () => {
      onOpenChange(false);
      setName("");
      setRef("");
      refresh();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't add"),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl sm:max-w-md">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-normal">Add an account</DialogTitle>
            <DialogDescription>Usually not needed: dropping a broker's files creates its account. Add one here to enter trades by hand.</DialogDescription>
          </DialogHeader>
          <Field label="Broker">
            <select value={broker} onChange={(e) => setBroker(e.target.value)} className="h-10 w-full cursor-pointer rounded-xl border border-input bg-background px-3.5 text-sm">
              {BROKERS.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Call it">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={brokerLabel(broker)} className="h-10 rounded-xl" />
          </Field>
          <Field label="Client code (optional)">
            <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. AB1234" className="h-10 rounded-xl" />
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={create.isPending}>
              Add account
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Confirm({ open, onOpenChange, title, body, confirm, busy, onConfirm }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; body: string; confirm: string; busy: boolean; onConfirm: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-normal">{title}</DialogTitle>
          <DialogDescription className="leading-relaxed">{body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Keep it</Button>
          </DialogClose>
          <Button variant="destructive" className={cn(busy && "opacity-70")} disabled={busy} onClick={onConfirm}>
            {confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

