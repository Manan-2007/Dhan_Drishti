import { useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useAuth } from "../auth/AuthContext.js";
import { ApiError } from "../lib/api.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Sign in, or create the one account this install needs. */
export function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "login") await login(username, password);
      else await register({ username, password, email: email || undefined });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full rounded-3xl border bg-card p-7 sm:p-8">
      <h2 className="font-display text-3xl">{mode === "login" ? "Welcome back" : "Create your account"}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{mode === "login" ? "Sign in to see where you stand." : "One account for this computer. It stays here."}</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Username</span>
          <Input className="h-11 rounded-xl" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required minLength={3} autoFocus />
        </label>
        <AnimatePresence initial={false}>
          {mode === "register" && (
            <motion.label
              className="block space-y-1.5 overflow-hidden"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22 }}
            >
              <span className="text-sm font-medium">
                Email <span className="text-muted-foreground">(optional)</span>
              </span>
              <Input className="h-11 rounded-xl" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </motion.label>
          )}
        </AnimatePresence>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Password</span>
          <Input
            className="h-11 rounded-xl"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={8}
          />
          {mode === "register" && <span className="text-xs text-muted-foreground">At least 8 characters.</span>}
        </label>
        {error && (
          <p role="alert" className="rounded-xl bg-loss/10 px-3 py-2 text-sm text-loss">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
        </Button>
      </form>
      <p className="mt-5 text-center text-sm text-muted-foreground">
        {mode === "login" ? "First time here? " : "Already have an account? "}
        <button
          type="button"
          className="cursor-pointer font-medium text-foreground underline-offset-4 hover:underline"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
          }}
        >
          {mode === "login" ? "Create an account" : "Sign in"}
        </button>
      </p>
    </div>
  );
}
