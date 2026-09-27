import { ChevronDown, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useFilter, usePortfolios } from "@/lib/hooks";

/** Whose money every screen shows: everyone, or one portfolio. */
export function ScopeSelect() {
  const { portfolioId, setPortfolioId } = useFilter();
  const { data: portfolios } = usePortfolios();
  const current = portfolios?.find((p) => p.id === portfolioId)?.name ?? "Everyone";
  if (!portfolios || portfolios.length < 2) return null; // nothing to choose between
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Choose whose portfolio to show">
          <Users /> {current} <ChevronDown className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56 rounded-2xl">
        <DropdownMenuLabel className="text-muted-foreground">Show</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={portfolioId ?? "all"} onValueChange={(v) => setPortfolioId(v === "all" ? null : v)}>
          <DropdownMenuRadioItem value="all">Everyone</DropdownMenuRadioItem>
          {portfolios.map((p) => (
            <DropdownMenuRadioItem key={p.id} value={p.id}>
              {p.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
