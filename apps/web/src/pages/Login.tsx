import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, Eye, EyeOff, Lock, UserPlus } from "lucide-react";
import { useAuth } from "../auth/AuthContext.js";
import { ApiError } from "../lib/api.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type AuthMode = "login" | "register";

/** How strong a new password is, in plain words (length matters most). */
function strength(pw: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  if (!pw) return { score: 0, label: "" };
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
  if (pw.length < 8) return { score: 1, label: "Too short — at least 8 characters" };
  const score = Math.max(1, Math.min(4, s)) as 1 | 2 | 3 | 4;
  return { score, label: ["", "Weak", "Okay", "Good", "Strong"][score]! };
}

function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

function PasswordInput({ value, onChange, autoComplete, id }: { value: string; onChange: (v: string) => void; autoComplete: string; id?: string }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative block">
      <Input id={id} className="h-11 rounded-xl pr-11" type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} required minLength={8} />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="absolute top-1/2 right-2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground hover:text-foreground"
        aria-label={show ? "Hide password" : "Show password"}
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </span>
  );
}

/**
 * Sign in, or create the account this install needs. The two are tabs of one card; the URL says
 * which (/signin, /signup) so each can be linked to.
 */
export function Login({ mode }: { mode: AuthMode }) {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pw = strength(password);
  const mismatch = mode === "register" && confirm.length > 0 && confirm !== password;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "register" && password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    // Opened from a deep link while signed out: land there once in.
    const from = (location.state as { from?: string } | null)?.from;
    const here = window.location.pathname + window.location.search;
    if (from) window.history.replaceState(null, "", from);
    setBusy(true);
    try {
      if (mode === "login") await login(username, password);
      else await register({ username, password, email: email || undefined });
    } catch (err) {
      if (from) window.history.replaceState(null, "", here);
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  const switchTo = (m: AuthMode) => {
    setError(null);
    navigate(m === "login" ? "/signin" : "/signup", { replace: true, state: location.state });
  };

  return (
    <div className="w-full rounded-3xl border bg-card p-7 shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)] sm:p-8">
      <div role="tablist" aria-label="Sign in or create an account" className="grid grid-cols-2 rounded-full border bg-background p-1 text-sm">
        {(["login", "register"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            type="button"
            onClick={() => switchTo(m)}
            className={cn("relative rounded-full py-2 font-medium transition-colors", mode === m ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {mode === m && <motion.span layoutId="auth-tab" className="absolute inset-0 rounded-full bg-primary" transition={{ type: "spring", bounce: 0.18, duration: 0.45 }} />}
            <span className="relative">{m === "login" ? "Sign in" : "Create account"}</span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={mode} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
          <h2 className="mt-7 font-display text-4xl">{mode === "login" ? "Welcome back" : "Create your account"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "login" ? "Sign in to see where you stand." : "It lives on this computer — nothing is sent anywhere."}
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <Field label="Username" hint={mode === "register" ? "3 or more characters. You'll sign in with it." : undefined}>
              <Input className="h-11 rounded-xl" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required minLength={3} autoFocus />
            </Field>
            {mode === "register" && (
              <Field
                label={
                  <>
                    Email <span className="font-normal text-muted-foreground">(optional)</span>
                  </>
                }
                hint="Only kept here, to tell accounts apart."
              >
                <Input className="h-11 rounded-xl" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              </Field>
            )}
            <Field label="Password">
              <PasswordInput value={password} onChange={setPassword} autoComplete={mode === "login" ? "current-password" : "new-password"} />
            </Field>
            {mode === "register" && (
              <>
                {password && (
                  <div aria-live="polite">
                    <div className="flex gap-1.5">
                      {[1, 2, 3, 4].map((i) => (
                        <span
                          key={i}
                          className={cn("h-1.5 flex-1 rounded-full transition-colors", i <= pw.score ? (pw.score <= 1 ? "bg-loss" : pw.score === 2 ? "bg-primary" : "bg-gain") : "bg-border")}
                        />
                      ))}
                    </div>
                    <p className={cn("mt-1.5 text-xs", pw.score <= 1 ? "text-loss" : "text-muted-foreground")}>{pw.label}</p>
                  </div>
                )}
                <Field label="Confirm password" hint={mismatch ? <span className="text-loss">Doesn't match yet.</span> : confirm && !mismatch ? <span className="inline-flex items-center gap-1 text-gain"><Check className="size-3" /> Matches</span> : undefined}>
                  <PasswordInput value={confirm} onChange={setConfirm} autoComplete="new-password" />
                </Field>
              </>
            )}
            {error && (
              <p role="alert" className="rounded-xl bg-loss/10 px-3 py-2 text-sm text-loss">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={busy || mismatch}>
              {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create my account"}
              {!busy && <ArrowRight />}
            </Button>
          </form>

          {mode === "login" ? (
            <button
              type="button"
              onClick={() => switchTo("register")}
              className="mt-6 flex w-full items-center gap-3 rounded-2xl border border-dashed bg-background/60 px-4 py-3.5 text-left transition-colors hover:border-primary/50"
            >
              <span className="grid size-9 place-items-center rounded-full bg-raised text-primary">
                <UserPlus className="size-4" />
              </span>
              <span className="flex-1">
                <span className="block text-sm font-semibold">New here? Create an account</span>
                <span className="block text-xs text-muted-foreground">Two minutes from now you'll see everything in one place.</span>
              </span>
              <ArrowRight className="size-4 text-muted-foreground" />
            </button>
          ) : (
            <p className="mt-6 flex items-start gap-2 text-xs text-muted-foreground">
              <Lock className="mt-0.5 size-3.5 shrink-0" />
              Your account and everything you add stay in this computer's database. Prices and news are fetched using public tickers only.
            </p>
          )}
        </motion.div>
      </AnimatePresence>
      <p className="mt-6 text-center text-xs text-muted-foreground">
        <Link to="/" className="hover:text-foreground hover:underline">
          ← What is Dhan Drishti?
        </Link>
      </p>
    </div>
  );
}
