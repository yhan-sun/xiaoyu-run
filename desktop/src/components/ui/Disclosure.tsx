import { useId, useState } from "react";
import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { IconChevronDown } from "./icons";

interface DisclosureProps {
  title: string;
  description?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  action?: ReactNode;
}

export function Disclosure({
  title,
  description,
  children,
  defaultOpen = false,
  className,
  action,
}: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const reduced = useReducedMotion();

  return (
    <div
      className={["disclosure", open ? "is-open" : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="disclosure-head">
        <button
          type="button"
          className="disclosure-trigger"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="disclosure-copy">
            <span className="disclosure-title">{title}</span>
            {description ? (
              <span className="disclosure-desc">{description}</span>
            ) : null}
          </span>
          <span className="disclosure-chevron" aria-hidden>
            <IconChevronDown size={17} />
          </span>
        </button>
        {action ? <div className="disclosure-action">{action}</div> : null}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="disclosure-panel"
            id={id}
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="disclosure-inner">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
