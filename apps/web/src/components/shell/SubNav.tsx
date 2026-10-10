import { useId } from "react";
import { NavLink } from "react-router-dom";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

export interface SubNavItem {
  label: string;
  to: string;
  end?: boolean;
  /** Shown after the label, e.g. a count. */
  badge?: React.ReactNode;
}

/** Segmented pill tabs for a destination's sub-pages; a solid thumb glides to the active tab. */
export function SubNav({ items, className }: { items: SubNavItem[]; className?: string }) {
  const layoutId = useId();
  return (
    <nav aria-label="Section" className={cn("inline-flex max-w-full overflow-x-auto rounded-full border bg-card p-1", className)}>
      {items.map((it) => (
        <NavLink
          key={it.to}
          to={it.to}
          end={it.end}
          className={({ isActive }) =>
            cn(
              "relative rounded-full px-4 py-1.5 text-sm font-medium whitespace-nowrap transition-colors duration-200",
              isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <motion.span
                  layoutId={layoutId}
                  className="absolute inset-0 rounded-full bg-raised"
                  transition={{ type: "spring", bounce: 0.18, duration: 0.45 }}
                />
              )}
              <span className="relative inline-flex items-center gap-1.5">
                {it.label}
                {it.badge}
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
