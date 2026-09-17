import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api.js";
import { useAuth } from "../auth/AuthContext.js";
import { PageHeader } from "../components/PageHeader.js";
import { Button, Card, Field, Input } from "../components/ui.js";

export function Settings() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [exporting, setExporting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function exportData() {
    setExporting(true);
    try {
      const res = await fetch("/api/account/export", { credentials: "include" });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dhan-drishti-export-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  async function deleteAccount() {
    setError(null);
    setBusy(true);
    try {
      await api.post("/api/account/delete", { password });
      qc.clear();
      await qc.invalidateQueries({ queryKey: ["me"] }); // Gate will show the login screen
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Settings" showFilter={false} />
      <div className="max-w-xl space-y-4">
        <Card>
          <h3 className="mb-3 font-serif text-lg">Account</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Username</dt>
              <dd className="font-medium">{user?.username}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Email</dt>
              <dd>{user?.email ?? "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Base currency</dt>
              <dd>{user?.baseCurrency}</dd>
            </div>
          </dl>
        </Card>

        <Card>
          <h3 className="font-serif text-lg">Your data</h3>
          <p className="mb-3 mt-1 text-sm text-muted-foreground">
            Dhan Drishti is local-first — your data stays on your instance. Download a full JSON export
            any time. To back up everything, copy the server's SQLite database file.
          </p>
          <Button variant="secondary" onClick={exportData} disabled={exporting}>
            {exporting ? "Preparing…" : "Export my data (JSON)"}
          </Button>
        </Card>

        <Card className="border-destructive/40">
          <h3 className="font-serif text-lg text-destructive">Delete account</h3>
          <p className="mb-3 mt-1 text-sm text-muted-foreground">
            Permanently deletes your account and all portfolios, accounts and transactions. This cannot be undone.
          </p>
          {!confirming ? (
            <Button variant="danger" onClick={() => setConfirming(true)}>
              Delete my account…
            </Button>
          ) : (
            <div className="space-y-3">
              <Field label="Confirm your password">
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
              </Field>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => { setConfirming(false); setPassword(""); setError(null); }}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={deleteAccount} disabled={!password || busy}>
                  {busy ? "Deleting…" : "Permanently delete"}
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
