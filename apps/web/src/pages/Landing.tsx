import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { Layers, Lock, Sparkles, Upload, Users, Laptop } from "lucide-react";
import { Background } from "@/components/shell/Background";
import { Login, type AuthMode } from "./Login.js";
import { PublicHome } from "./public/PublicHome.js";
import { BrokerMark, SOURCES } from "./public/BrokerMarks.js";

const SIGN_IN_POINTS = [
  { icon: Layers, text: "Every broker in one place: Zerodha, Dhan, Vested, mutual fund statements and more." },
  { icon: Sparkles, text: "Drop the files; it works out the rest and shows what changed." },
  { icon: Lock, text: "Runs on this computer. Your holdings never leave it." },
];

const SIGN_UP_STEPS = [
  { icon: Laptop, title: "Create your account", body: "A username and password, kept on this computer." },
  { icon: Users, title: "Tell us your brokers", body: "Just you, or the family too — it sets up the accounts." },
  { icon: Upload, title: "Drop in your files", body: "Tradebooks, statements, your mutual-fund CAS." },
];

/** Signed out: the front page, sign-in and sign-up. Any other address asks you to sign in first. */
export function PublicSite() {
  const location = useLocation();
  return (
    <Routes>
      <Route path="/" element={<PublicHome />} />
      <Route path="/signin" element={<AuthPage mode="login" />} />
      <Route path="/signup" element={<AuthPage mode="register" />} />
      <Route path="*" element={<Navigate to="/signin" replace state={{ from: location.pathname + location.search }} />} />
    </Routes>
  );
}

/** Sign in / create an account: the card on the right, what you get on the left, over the dot field. */
function AuthPage({ mode }: { mode: AuthMode }) {
  const reduceMotion = useReducedMotion();
  const rise = (delay: number) => (reduceMotion ? {} : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { delay, duration: 0.5, ease: [0.22, 1, 0.36, 1] as const } });
  return (
    <div className="relative min-h-screen overflow-hidden">
      <Background />
      <div className="relative z-10 mx-auto grid min-h-screen max-w-6xl items-center gap-12 px-6 py-12 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <motion.div {...rise(0)}>
            <Link to="/" className="inline-flex items-center gap-3" aria-label="Dhan Drishti home">
              <span className="grid size-12 place-items-center rounded-full bg-primary font-display text-3xl leading-none text-primary-foreground">द</span>
              <span className="text-sm font-semibold tracking-[0.18em] uppercase">Dhan Drishti</span>
            </Link>
          </motion.div>

          {mode === "login" ? (
            <>
              <motion.h1 {...rise(0.08)} className="mt-10 font-display text-6xl leading-[0.95] tracking-tight sm:text-7xl">
                All your money.
                <br />
                <span className="text-primary italic">One honest view.</span>
              </motion.h1>
              <ul className="mt-10 space-y-4">
                {SIGN_IN_POINTS.map((p, i) => (
                  <motion.li key={p.text} {...rise(0.16 + i * 0.07)} className="flex max-w-md items-start gap-3 text-muted-foreground">
                    <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full border bg-card text-foreground">
                      <p.icon className="size-4" />
                    </span>
                    <span className="pt-1">{p.text}</span>
                  </motion.li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <motion.h1 {...rise(0.08)} className="mt-10 font-display text-6xl leading-[0.95] tracking-tight sm:text-7xl">
                Set up in
                <br />
                <span className="text-primary italic">two minutes.</span>
              </motion.h1>
              <ol className="relative mt-10 max-w-md space-y-6">
                <span className="absolute top-4 bottom-4 left-[19px] w-px border-l border-dashed border-primary/40" aria-hidden />
                {SIGN_UP_STEPS.map((s, i) => (
                  <motion.li key={s.title} {...rise(0.16 + i * 0.09)} className="relative flex items-start gap-4">
                    <span className="grid size-10 shrink-0 place-items-center rounded-full border bg-card text-primary">
                      <s.icon className="size-4" />
                    </span>
                    <span className="pt-1">
                      <span className="block font-semibold">
                        <span className="mr-2 text-xs text-muted-foreground">0{i + 1}</span>
                        {s.title}
                      </span>
                      <span className="mt-0.5 block text-sm text-muted-foreground">{s.body}</span>
                    </span>
                  </motion.li>
                ))}
              </ol>
              <motion.div {...rise(0.45)} className="mt-10 flex flex-wrap items-center gap-2">
                <span className="mr-1 text-xs text-muted-foreground">Reads files from</span>
                {SOURCES.slice(0, 6).map((s) => (
                  <BrokerMark key={s.id} id={s.id} size={28} />
                ))}
              </motion.div>
            </>
          )}
        </div>
        <motion.div {...rise(0.12)} className="w-full max-w-md justify-self-center lg:justify-self-end">
          <Login mode={mode} />
        </motion.div>
      </div>
    </div>
  );
}
