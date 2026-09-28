import type { ReactNode } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { SubNav, type SubNavItem } from "./SubNav";

/** A destination: its title, one line on what it answers, sub-tabs, then the active sub-page. */
export function Section({ title, lead, tabs, actions }: { title: string; lead: string; tabs: SubNavItem[]; actions?: ReactNode }) {
  const { pathname } = useLocation();
  const reduceMotion = useReducedMotion();
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl leading-none tracking-tight sm:text-5xl">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{lead}</p>
        </div>
        {actions}
      </div>
      <SubNav items={tabs} />
      <motion.div
        key={pathname}
        initial={reduceMotion ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      >
        <Outlet />
      </motion.div>
    </div>
  );
}
