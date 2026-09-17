import type { ReactNode } from "react";
import { useFilter, usePortfolios } from "../lib/hooks.js";
import { Select } from "./ui.js";

export function PortfolioSelect() {
  const { portfolioId, setPortfolioId } = useFilter();
  const { data: portfolios } = usePortfolios();
  return (
    <Select
      className="h-9 w-auto min-w-40"
      value={portfolioId ?? "all"}
      onChange={(e) => setPortfolioId(e.target.value === "all" ? null : e.target.value)}
    >
      <option value="all">All portfolios</option>
      {portfolios?.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </Select>
  );
}

export function PageHeader({ title, subtitle, actions, showFilter = true }: { title: string; subtitle?: string; actions?: ReactNode; showFilter?: boolean }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="font-serif text-2xl">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2 max-sm:w-full max-sm:flex-wrap">
        {showFilter && <PortfolioSelect />}
        {actions}
      </div>
    </div>
  );
}
