import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { cn } from "./cn";

type Tone = "info" | "error";
interface ToastItem {
  id: number;
  text: string;
  tone: Tone;
}

const ToastContext = createContext<(text: string, tone?: Tone) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

// Errors are announced assertively, everything else politely.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const show = useCallback((text: string, tone: Tone = "info") => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, text, tone }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), tone === "error" ? 6000 : 3000);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+56px)] z-50 flex flex-col items-center gap-2 px-4">
        <div aria-live="polite" className="contents">
          {items.filter((t) => t.tone === "info").map((t) => (
            <ToastView key={t.id} item={t} />
          ))}
        </div>
        <div aria-live="assertive" className="contents">
          {items.filter((t) => t.tone === "error").map((t) => (
            <ToastView key={t.id} item={t} />
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

function ToastView({ item }: { item: ToastItem }) {
  return (
    <div
      role={item.tone === "error" ? "alert" : "status"}
      className={cn(
        "max-w-sm rounded-md px-4 py-2 text-sm shadow-pop",
        item.tone === "error" ? "bg-danger text-on-danger" : "bg-surface-3 text-text",
      )}
    >
      {item.text}
    </div>
  );
}
