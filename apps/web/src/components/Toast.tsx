import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

interface ToastAction {
  label: string;
  onClick: () => void;
}
interface ToastItem {
  id: number;
  message: string;
  action?: ToastAction;
}
interface ToastCtx {
  showToast: (message: string, action?: ToastAction) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

/** Lightweight transient notifications with an optional action (e.g. Undo). Auto-dismiss after 6s. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const showToast = useCallback(
    (message: string, action?: ToastAction) => {
      const id = (idRef.current += 1);
      setItems((xs) => [...xs, { id, message, action }]);
      setTimeout(() => dismiss(id), 6000);
    },
    [dismiss],
  );

  return (
    <Ctx.Provider value={{ showToast }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
        {items.map((t) => (
          <div key={t.id} className="pointer-events-auto flex items-center gap-3 rounded-lg border bg-card px-4 py-2.5 text-sm shadow-lg">
            <span>{t.message}</span>
            {t.action && (
              <button
                className="font-medium text-primary underline underline-offset-2"
                onClick={() => {
                  t.action!.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button className="text-muted-foreground hover:text-foreground" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              ✕
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
