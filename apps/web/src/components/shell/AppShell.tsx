import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { LogOut, Plus, Search, Settings } from "lucide-react";
import PillNav from "@/components/reactbits/PillNav";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Toaster } from "@/components/ui/sonner";
import { useAuth } from "@/auth/AuthContext";
import { Background } from "./Background";
import { CommandMenu } from "./CommandMenu";
import { DESTINATIONS, destinationFor } from "./nav";
import { DropProvider, GlobalDropOverlay } from "./DropContext";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Typing into a field must never trigger a shortcut. */
function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

// "g" then a letter jumps to a destination, like Gmail / GitHub.
const G_JUMPS: Record<string, string> = { h: "/", p: "/portfolio", a: "/activity", f: "/performance", c: "/accounts" };

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const reduceMotion = useReducedMotion();
  const [cmdOpen, setCmdOpen] = useState(false);
  const gPressedAt = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((o) => !o);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === "g") {
        gPressedAt.current = performance.now();
        return;
      }
      const target = G_JUMPS[key];
      if (target && performance.now() - gPressedAt.current < 900) {
        gPressedAt.current = 0;
        e.preventDefault();
        navigate(target);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  const initial = (user?.username ?? "?").slice(0, 1).toUpperCase();

  return (
    <DropProvider>
    <div className="relative min-h-screen">
      <Background />
      <GlobalDropOverlay />

      <header className="sticky top-0 z-40 border-b bg-background">
        <div className="mx-auto flex max-w-[1280px] items-center gap-3 px-4 py-3 sm:px-6">
          <PillNav
            logo={<span className="font-display text-[26px] leading-none">द</span>}
            logoLabel="Dhan Drishti home"
            items={DESTINATIONS.map((d) => ({ label: d.label, href: d.href }))}
            activeHref={destinationFor(location.pathname)}
          />
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" className="hidden text-muted-foreground sm:inline-flex" onClick={() => setCmdOpen(true)} aria-label="Search">
              <Search />
              <span className="hidden lg:inline">Search</span>
              <kbd className="ml-1 hidden rounded-md border bg-raised px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground lg:inline">
                {isMac ? "⌘K" : "Ctrl K"}
              </kbd>
            </Button>
            <Button variant="outline" size="icon" className="sm:hidden" onClick={() => setCmdOpen(true)} aria-label="Search">
              <Search />
            </Button>
            <Button onClick={() => navigate("/accounts")}>
              <Plus />
              <span className="hidden sm:inline">Add data</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="icon" aria-label="Account menu" className="font-semibold">
                  {initial}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52 rounded-2xl">
                <DropdownMenuLabel className="text-muted-foreground">{user?.username}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => navigate("/settings")}>
                  <Settings /> Settings
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void logout()}>
                  <LogOut /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-[1280px] px-4 pt-8 pb-24 sm:px-6">
        {/* Each destination eases in on arrival (sub-tabs animate their own content, so the tab
            bar stays mounted and its thumb can glide). No exit animation: navigation never waits. */}
        <motion.div
          key={destinationFor(location.pathname)}
          initial={reduceMotion ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        >
          <Outlet />
        </motion.div>
      </main>

      <CommandMenu open={cmdOpen} onOpenChange={setCmdOpen} />
      <Toaster position="bottom-right" />
    </div>
    </DropProvider>
  );
}
