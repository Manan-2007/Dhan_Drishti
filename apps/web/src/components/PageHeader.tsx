import type { ReactNode } from "react";
import { ScopeSelect } from "@/components/shell/ScopeSelect";

/** Kept for pages not yet rebuilt: the whose-money switcher, now the shared ScopeSelect. */
export function PortfolioSelect() {
  return <ScopeSelect />;
}

/**
 * A sub-page heading. The destination (Portfolio, Activity…) already shows the big title and
 * tabs, so this stays a quiet second level: a short title, an optional line, and the actions.
 */
export function PageHeader({ title, subtitle, actions, showFilter = true }: { title: string; subtitle?: string; actions?: ReactNode; showFilter?: boolean }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2 max-sm:w-full">
        {showFilter && <ScopeSelect />}
        {actions}
      </div>
    </div>
  );
}
