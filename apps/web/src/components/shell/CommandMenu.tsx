import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRight, LogOut, RefreshCw, Upload } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { useAuth } from "@/auth/AuthContext";
import { useFilter, useHoldings } from "@/lib/hooks";
import { useRefreshPrices } from "@/lib/prices";
import { compactMoney } from "@/lib/format";
import { JUMP_TARGETS } from "./nav";

/** ⌘K: jump to any page, open any holding, or run an action — without hunting through menus. */
export function CommandMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { portfolioId, scope } = useFilter();
  const { data } = useHoldings(scope);
  const refresh = useRefreshPrices();

  const holdings = (data?.holdings ?? []).filter((h) => Number(h.netQty) !== 0);

  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search Dhan Drishti" description="Jump to a page, a holding, or an action">
      <CommandInput placeholder="Search pages, holdings, actions…" />
      <CommandList>
        <CommandEmpty>Nothing matches that.</CommandEmpty>
        <CommandGroup heading="Actions">
          <CommandItem value="add data import upload files" onSelect={() => run(() => navigate("/accounts"))}>
            <Upload /> Add data
            <CommandShortcut>Import files</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="refresh prices quotes update"
            onSelect={() =>
              run(() =>
                toast.promise(refresh.mutateAsync(), {
                  loading: "Refreshing prices…",
                  success: (r) => `Priced ${r.updated} of ${r.requested}${r.failed ? ` · ${r.failed} without a price` : ""}`,
                  error: "Couldn't refresh prices",
                }),
              )
            }
          >
            <RefreshCw /> Refresh prices
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Go to">
          {JUMP_TARGETS.map((t) => (
            <CommandItem key={t.to} value={`${t.label} ${t.keywords}`} onSelect={() => run(() => navigate(t.to))}>
              <ArrowRight /> {t.label}
            </CommandItem>
          ))}
        </CommandGroup>
        {holdings.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Your holdings">
              {holdings.map((h) => (
                <CommandItem
                  key={h.security.id}
                  value={`${h.security.symbol} ${h.security.name} ${h.security.sector ?? ""}`}
                  onSelect={() => run(() => navigate(`/portfolio/security/${h.security.id}`))}
                >
                  <span className="truncate font-medium">{h.security.symbol}</span>
                  <span className="truncate text-muted-foreground">{h.security.name !== h.security.symbol ? h.security.name : ""}</span>
                  <CommandShortcut>{h.baseCurrentValue !== null ? compactMoney(h.baseCurrentValue) : ""}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
        <CommandSeparator />
        <CommandGroup heading="Account">
          <CommandItem value="sign out log out" onSelect={() => run(() => void logout())}>
            <LogOut /> Sign out
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
