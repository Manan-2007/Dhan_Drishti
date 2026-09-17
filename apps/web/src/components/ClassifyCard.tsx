import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api.js";
import { Button, Card } from "./ui.js";

interface ClassifyResult {
  updated: number;
  notFoundCount: number;
}

export function ClassifyCard() {
  const qc = useQueryClient();
  const [content, setContent] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: () => api.post<ClassifyResult>("/api/securities/classify", { content }),
    onSuccess: (r) => {
      setMsg(`Updated ${r.updated} securities${r.notFoundCount ? ` · ${r.notFoundCount} not matched` : ""}`);
      void qc.invalidateQueries({ queryKey: ["holdings"] });
    },
    onError: (e) => setMsg(e instanceof ApiError ? e.message : "Classification failed"),
  });

  return (
    <Card className="h-fit">
      <h3 className="text-sm font-medium text-muted-foreground">Classify securities</h3>
      <p className="mb-3 mt-1 text-xs text-muted-foreground">
        Enrich sectors & names from a reference CSV (columns: symbol, name, asset_class, sector). This adds
        market metadata on top of imported data — it never changes your transactions.
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) {
            setName(f.name);
            setContent(await f.text());
          }
        }}
        className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:bg-card file:px-3 file:py-1.5 file:text-sm"
      />
      {name && <p className="mt-1 text-xs text-muted-foreground">{name}</p>}
      {msg && <p className="mt-2 text-sm text-foreground">{msg}</p>}
      <Button variant="secondary" className="mt-3 w-full" disabled={!content || run.isPending} onClick={() => run.mutate()}>
        {run.isPending ? "Classifying…" : "Apply classification"}
      </Button>
    </Card>
  );
}
