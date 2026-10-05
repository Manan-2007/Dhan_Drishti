/** The top destinations. Every other page lives under one of them. */
export const DESTINATIONS = [
  { label: "Home", href: "/" },
  { label: "Portfolio", href: "/portfolio" },
  { label: "Activity", href: "/activity" },
  { label: "Performance", href: "/performance" },
  { label: "Research", href: "/research" },
  { label: "News", href: "/news" },
  { label: "Accounts", href: "/accounts" },
] as const;

/** Which destination a path belongs to (by its first segment). */
export function destinationFor(pathname: string): string {
  const seg = pathname.split("/")[1] ?? "";
  if (seg === "") return "/";
  const hit = DESTINATIONS.find((d) => d.href !== "/" && d.href.slice(1) === seg);
  return hit ? hit.href : pathname; // e.g. /settings: no destination lit up
}

/** Everything the command bar can jump to, in the order people look for it. */
export const JUMP_TARGETS = [
  { label: "Home", to: "/", keywords: "dashboard net worth overview" },
  { label: "Positions", to: "/portfolio", keywords: "holdings stocks funds portfolio" },
  { label: "Allocation", to: "/portfolio/allocation", keywords: "sector asset class diversification split" },
  { label: "Health (X-ray)", to: "/portfolio/health", keywords: "xray health concentration cash drag risk diversification score" },
  { label: "Other assets", to: "/portfolio/other", keywords: "fd property gold epf ppf manual" },
  { label: "Timeline", to: "/activity", keywords: "activity transactions trades ledger buy sell bought sold" },
  { label: "Dividends", to: "/activity/income", keywords: "income interest payouts yield" },
  { label: "Returns", to: "/performance", keywords: "analytics xirr twr benchmark nifty pnl" },
  { label: "Tax", to: "/performance/tax", keywords: "capital gains ltcg stcg report" },
  { label: "Rebalance", to: "/performance/rebalance", keywords: "targets drift" },
  { label: "Research a stock", to: "/research", keywords: "research stock search technicals rsi moving average chart fundamentals" },
  { label: "News", to: "/news", keywords: "headlines ai risks outlook market today live" },
  { label: "Import files", to: "/accounts", keywords: "upload csv excel cas add data broker" },
  { label: "People & accounts", to: "/accounts/portfolios", keywords: "family members brokers portfolios groups" },
  { label: "Settings", to: "/settings", keywords: "export delete account fx rates" },
] as const;
