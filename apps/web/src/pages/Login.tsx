import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { ApiError } from "../lib/api.js";
import { Button, Card, Field, Input } from "../components/ui.js";

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
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <div className="grid h-10 w-10 place-items-center rounded-md bg-primary font-serif text-primary-foreground">द</div>
          <span className="font-serif text-2xl">Dhan Drishti</span>
        </div>
        <Card>
          <h1 className="mb-1 font-serif text-lg">{mode === "login" ? "Sign in" : "Create your account"}</h1>
          <p className="mb-4 text-sm text-muted-foreground">Private, self-hosted portfolio tracking.</p>
          <form onSubmit={submit} className="space-y-4">
            <Field label="Username">
              <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required minLength={3} />
            </Field>
            {mode === "register" && (
              <Field label="Email (optional)">
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              </Field>
            )}
            <Field label="Password">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                required
                minLength={8}
              />
            </Field>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            {mode === "login" ? "New here? " : "Have an account? "}
            <button
              className="font-medium text-foreground underline"
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setError(null);
              }}
            >
              {mode === "login" ? "Create an account" : "Sign in"}
            </button>
          </p>
        </Card>
      </div>
    </div>
  );
}
