import { useId, useRef } from "react";
import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  ariaLabel?: string;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  disabled = false,
  className,
}: SegmentedControlProps<T>) {
  const layoutId = useId();
  const reduced = useReducedMotion();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const move = (dir: 1 | -1) => {
    const index = options.findIndex((o) => o.value === value);
    const next = (index + dir + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div
      className={["segmented", className ?? ""].filter(Boolean).join(" ")}
      role="radiogroup"
      aria-label={ariaLabel}
      data-disabled={disabled || undefined}
    >
      {options.map((option, index) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.ariaLabel ?? option.label}
            tabIndex={active ? 0 : -1}
            className={"segmented-item" + (active ? " is-active" : "")}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault();
                move(1);
              } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault();
                move(-1);
              }
            }}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="segmented-indicator"
                transition={
                  reduced
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 420, damping: 36, mass: 0.7 }
                }
              />
            )}
            {option.icon ? (
              <span className="segmented-icon">{option.icon}</span>
            ) : null}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
