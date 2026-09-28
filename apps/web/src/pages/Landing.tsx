import { motion, useReducedMotion } from "motion/react";
import { Lock, Layers, Sparkles } from "lucide-react";
import { Background } from "@/components/shell/Background";
import { Login } from "./Login.js";

const POINTS = [
  { icon: Layers, text: "Every broker in one place: Zerodha, Dhan, Vested, mutual fund statements and more." },
  { icon: Sparkles, text: "Drop the files; it works out the rest and shows what changed." },
  { icon: Lock, text: "Runs on this computer. Your holdings never leave it." },
];

/** Signed-out screen: the brand on the left, sign-in on the right, over the live dot field. */
export function Landing() {
  const reduceMotion = useReducedMotion();
  const rise = (delay: number) => (reduceMotion ? {} : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { delay, duration: 0.5, ease: [0.22, 1, 0.36, 1] as const } });
  return (
    <div className="relative min-h-screen overflow-hidden">
      <Background />
      <div className="relative z-10 mx-auto grid min-h-screen max-w-6xl items-center gap-12 px-6 py-12 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <motion.div {...rise(0)} className="flex items-center gap-3">
            <span className="grid size-12 place-items-center rounded-full bg-primary font-display text-3xl leading-none text-primary-foreground">द</span>
            <span className="text-sm font-semibold tracking-[0.18em] uppercase">Dhan Drishti</span>
          </motion.div>
          <motion.h1 {...rise(0.08)} className="mt-10 font-display text-6xl leading-[0.95] tracking-tight sm:text-7xl">
            All your money.
            <br />
            <span className="text-primary italic">One honest view.</span>
          </motion.h1>
          <ul className="mt-10 space-y-4">
            {POINTS.map((p, i) => (
              <motion.li key={p.text} {...rise(0.16 + i * 0.07)} className="flex max-w-md items-start gap-3 text-muted-foreground">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full border bg-card text-foreground">
                  <p.icon className="size-4" />
                </span>
                <span className="pt-1">{p.text}</span>
              </motion.li>
            ))}
          </ul>
        </div>
        <motion.div {...rise(0.12)} className="w-full max-w-md justify-self-center lg:justify-self-end">
          <Login />
        </motion.div>
      </div>
    </div>
  );
}
