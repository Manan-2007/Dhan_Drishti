// Primitives used by pages not yet rebuilt. Styled to match the new design system (round buttons,
// rounded cards, solid colours) so those pages look consistent inside the new shell. New pages use
// the shadcn components in ./ui/ instead.
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Class joiner with Tailwind conflict resolution, so a caller's `h-9` really overrides `h-10`. */
export const cx = cn;

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  const base =
    "inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-full px-5 text-sm font-medium transition-[background-color,color,border-color,transform] duration-200 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50";
  const styles = {
    primary: "bg-primary text-primary-foreground hover:bg-[#f5c261]",
    secondary: "border border-border bg-transparent text-foreground hover:border-[#3a3a42] hover:bg-raised",
    ghost: "text-muted-foreground hover:bg-raised hover:text-foreground",
    danger: "bg-destructive text-destructive-foreground hover:bg-[#f47f78]",
  }[variant];
  return <button className={cn(base, styles, className)} {...props} />;
}

const field =
  "h-10 w-full rounded-xl border border-input bg-background px-3.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/30";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(field, className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(field, "cursor-pointer", className)} {...props}>
      {children}
    </select>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-2xl border bg-card p-5", className)}>{children}</div>;
}

export function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "success" | "danger" | "warning" }) {
  const styles = {
    muted: "bg-raised text-muted-foreground",
    success: "bg-gain/15 text-gain",
    danger: "bg-loss/15 text-loss",
    warning: "bg-warning/15 text-warning",
  }[tone];
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", styles)}>{children}</span>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" />
      {label ?? "Loading…"}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Card className="border-dashed py-12 text-center">
      <h3 className="font-display text-3xl">{title}</h3>
      {children && <div className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{children}</div>}
    </Card>
  );
}
