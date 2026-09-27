/** The five destinations. Every other page lives under one of them. */
export const DESTINATIONS = [
  { label: "Home", href: "/" },
  { label: "Portfolio", href: "/portfolio" },
  { label: "Activity", href: "/activity" },
  { label: "Performance", href: "/performance" },
  { label: "Accounts", href: "/accounts" },
] as const;

/** Which destination a path belongs to (by its first segment). */
export function destinationFor(pathname: string): string {
  const seg = pathname.split("/")[1] ?? "";
  const hit = DESTINATIONS.find((d) => d.href !== "/" && d.href.slice(1) === seg);
  return hit ? hit.href : "/";
}

/** Everything the command bar can jump to, in the order people look for it. */
export const JUMP_TARGETS = [
  { label: "Home", to: "/", keywords: "dashboard net worth overview" },
  { label: "Positions", to: "/portfolio", keywords: "holdings stocks funds portfolio" },
  { label: "Allocation", to: "/portfolio/allocation", keywords: "sector asset class diversification split" },
  { label: "Other assets", to: "/portfolio/other", keywords: "fd property gold epf ppf manual" },
  { label: "All activity", to: "/activity", keywords: "transactions trades ledger buy sell" },
  { label: "Income", to: "/activity/income", keywords: "dividends interest payouts" },
  { label: "Returns", to: "/performance", keywords: "analytics xirr twr benchmark nifty pnl" },
  { label: "Tax", to: "/performance/tax", keywords: "capital gains ltcg stcg report" },
  { label: "Rebalance", to: "/performance/rebalance", keywords: "targets drift" },
  { label: "Import files", to: "/accounts", keywords: "upload csv excel cas add data broker" },
  { label: "Portfolios & accounts", to: "/accounts/portfolios", keywords: "family members brokers groups" },
  { label: "Settings", to: "/settings", keywords: "export delete account fx rates" },
] as const;
