import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { Upload } from "lucide-react";

interface DropCtx {
  /** Files dropped somewhere in the app, waiting for the import screen to pick them up. */
  pending: File[];
  offer: (files: File[]) => void;
  take: () => File[];
}

const Ctx = createContext<DropCtx | null>(null);

export function DropProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<File[]>([]);
  const ref = useRef<File[]>([]);
  const offer = useCallback((files: File[]) => {
    ref.current = [...ref.current, ...files];
    setPending(ref.current);
  }, []);
  const take = useCallback(() => {
    const out = ref.current;
    ref.current = [];
    setPending([]);
    return out;
  }, []);
  return <Ctx.Provider value={{ pending, offer, take }}>{children}</Ctx.Provider>;
}

export function useDropFiles(): DropCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDropFiles must be used within DropProvider");
  return ctx;
}

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

/** Drag files over any screen: a full-window target appears; dropping sends them to import. */
export function GlobalDropOverlay() {
  const { offer } = useDropFiles();
  const navigate = useNavigate();
  const [active, setActive] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      setActive(true);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setActive(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setActive(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      offer(files);
      navigate("/accounts");
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [offer, navigate]);

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          className="pointer-events-none fixed inset-0 z-[100] grid place-items-center bg-background/90 p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <motion.div
            initial={{ scale: 0.96 }}
            animate={{ scale: 1 }}
            className="grid h-full max-h-[520px] w-full max-w-3xl place-items-center rounded-[32px] border-2 border-dashed border-primary bg-card text-center"
          >
            <div>
              <span className="mx-auto grid size-16 place-items-center rounded-full bg-primary text-primary-foreground">
                <Upload className="size-7" />
              </span>
              <p className="mt-5 font-display text-4xl">Drop to import</p>
              <p className="mt-2 text-muted-foreground">Broker files, mutual fund statements, or a ZIP of them all.</p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
