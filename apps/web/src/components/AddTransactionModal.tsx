import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Portfolio } from "../lib/api.js";
import { Button, Card, Field, Input, Select } from "./ui.js";

// Grouped so the form shows only the fields a given type needs.
const TYPES: { value: string; label: string; group: "cash" | "income" | "trade" }[] = [
  { value: "deposit", label: "Deposit (cash in)", group: "cash" },
  { value: "withdrawal", label: "Withdrawal (cash out)", group: "cash" },
  { value: "dividend", label: "Dividend received", group: "income" },
  { value: "interest", label: "Interest received", group: "cash" },
  { value: "buy", label: "Buy", group: "trade" },
  { value: "sell", label: "Sell", group: "trade" },
  { value: "fee", label: "Fee / charge", group: "cash" },
  { value: "tax", label: "Tax", group: "cash" },
];
const groupOf = (t: string) => TYPES.find((x) => x.value === t)?.group ?? "cash";
const today = () => new Date().toISOString().slice(0, 10);

export function AddTransactionModal({
  portfolios,
  defaultPortfolioId,
  onClose,
}: {
  portfolios: Portfolio[];
  defaultPortfolioId: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [portfolioId, setPortfolioId] = useState(defaultPortfolioId ?? portfolios[0]?.id ?? "");
  const [type, setType] = useState("deposit");
  const [date, setDate] = useState(today());
  const [currency, setCurrency] = useState("INR");
  const [amount, setAmount] = useState("");
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [fees, setFees] = useState("");
  const [error, setError] = useState<string | null>(null);

  const group = groupOf(type);
  const needsSecurity = group === "trade" || type === "dividend";
  const needsQtyPrice = group === "trade";
  const needsAmount = group === "cash" || type === "dividend";

  const save = useMutation({
    mutationFn: async () => {
      let securityId: string | undefined;
      if (needsSecurity) {
        const { security } = await api.post<{ security: { id: string } }>("/api/securities", {
          symbol: symbol.trim().toUpperCase(),
          name: name.trim() || symbol.trim(),
          assetClass: "equity",
          currency,
        });
        securityId = security.id;
      }
      const payload: Record<string, unknown> = { portfolioId, type, tradeDate: date, currency };
      if (needsQtyPrice) {
        payload.securityId = securityId;
        payload.quantity = quantity;
        payload.price = price;
        if (fees.trim()) payload.fees = fees;
      } else if (type === "dividend") {
        payload.securityId = securityId;
        payload.grossAmount = amount;
      } else {
        payload.grossAmount = amount;
      }
      return api.post("/api/transactions", payload);
    },
    onSuccess: () => {
      for (const key of ["holdings", "transactions", "dividends", "performance", "goals", "twr"]) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not save"),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!portfolioId) return setError("Pick a portfolio");
    save.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-serif text-lg">Add transaction</h2>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">✕</button>
          </div>
          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Portfolio">
                <Select value={portfolioId} onChange={(e) => setPortfolioId(e.target.value)} required>
                  {portfolios.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Type">
                <Select value={type} onChange={(e) => setType(e.target.value)}>
                  {TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </Select>
              </Field>
            </div>

            {needsSecurity && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Symbol">
                  <Input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="e.g. INFY" required />
                </Field>
                <Field label="Name (optional)">
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Infosys" />
                </Field>
              </div>
            )}

            {needsQtyPrice && (
              <div className="grid grid-cols-3 gap-3">
                <Field label="Quantity">
                  <Input type="number" step="any" min="0" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
                </Field>
                <Field label="Price">
                  <Input type="number" step="any" min="0" value={price} onChange={(e) => setPrice(e.target.value)} required />
                </Field>
                <Field label="Fees">
                  <Input type="number" step="any" min="0" value={fees} onChange={(e) => setFees(e.target.value)} placeholder="0" />
                </Field>
              </div>
            )}

            {needsAmount && (
              <Field label="Amount">
                <Input type="number" step="any" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} required />
              </Field>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Date">
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              </Field>
              <Field label="Currency">
                <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} />
              </Field>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : "Add transaction"}</Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
