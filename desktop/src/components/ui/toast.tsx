import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { IconAlert, IconCheck, IconInfo } from "./icons";

export type ToastTone = "success" | "error" | "info" | "warning";

export interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

type Listener = (item: ToastItem) => void;

const listeners = new Set<Listener>();
let nextId = 1;

export function toast(message: string, tone: ToastTone = "info") {
  const item = { id: nextId++, tone, message };
  listeners.forEach((l) => l(item));
}

toast.success = (message: string) => toast(message, "success");
toast.error = (message: string) => toast(message, "error");
toast.warning = (message: string) => toast(message, "warning");
toast.info = (message: string) => toast(message, "info");

export function ToastHost() {
  const [item, setItem] = useState<ToastItem | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const listener: Listener = (next) => setItem(next);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!item) return;
    const t = window.setTimeout(() => setItem(null), 2600);
    return () => window.clearTimeout(t);
  }, [item]);

  const icon =
    item?.tone === "success" ? (
      <IconCheck size={17} />
    ) : item?.tone === "error" || item?.tone === "warning" ? (
      <IconAlert size={17} />
    ) : (
      <IconInfo size={17} />
    );

  return (
    <div className="toast-host" aria-live="polite" aria-atomic="true">
      <AnimatePresence>
        {item && (
          <motion.div
            key={item.id}
            className={`toast toast--${item.tone}`}
            role={item.tone === "error" ? "alert" : "status"}
            initial={reduced ? false : { opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.99 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="toast-icon">{icon}</span>
            <span>{item.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
