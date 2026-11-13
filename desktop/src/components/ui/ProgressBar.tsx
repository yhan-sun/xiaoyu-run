import { useEffect, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";

interface ProgressBarProps {
  value: number;
  tone?: "accent" | "success" | "danger";
  label?: string;
  height?: number;
  className?: string;
}

export function ProgressBar({
  value,
  tone = "accent",
  label,
  height = 6,
  className,
}: ProgressBarProps) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const reduced = useReducedMotion();
  const previous = useRef(value);
  const snap = reduced || (previous.current === 0 && value > 0.1) || value >= 1;
  useEffect(() => { previous.current = value; }, [value]);

  return (
    <div
      className={["progress", `progress--${tone}`, className ?? ""]
        .filter(Boolean)
        .join(" ")}
      style={{ height }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label}
    >
      <motion.div
        className="progress-fill"
        initial={false}
        animate={{ scaleX: pct / 100 }}
        transition={
          snap
            ? { duration: 0 }
            : { duration: 0.18, ease: [0.22, 1, 0.36, 1] }
        }
      />
    </div>
  );
}
