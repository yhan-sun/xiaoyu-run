import { forwardRef } from "react";
import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { HTMLMotionProps } from "motion/react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  children?: ReactNode;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  trailing?: ReactNode;
  full?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      loading = false,
      icon,
      trailing,
      full = false,
      disabled,
      className,
      children,
      ...rest
    },
    ref
  ) {
    const reduced = useReducedMotion();
    const inactive = disabled || loading;

    return (
      <motion.button
        ref={ref}
        type="button"
        className={[
          "btn",
          `btn--${variant}`,
          `btn--${size}`,
          full ? "btn--full" : "",
          loading ? "is-loading" : "",
          className ?? "",
        ]
          .filter(Boolean)
          .join(" ")}
        disabled={inactive}
        aria-busy={loading || undefined}
        whileTap={reduced || inactive ? undefined : { scale: 0.96 }}
        transition={{ type: "spring", stiffness: 520, damping: 34, mass: 0.6 }}
        {...rest}
      >
        {loading ? (
          <span className="spinner" aria-hidden />
        ) : icon ? (
          <span className="btn-icon">{icon}</span>
        ) : null}
        <span className="btn-label">{children}</span>
        {trailing ? <span className="btn-trailing">{trailing}</span> : null}
      </motion.button>
    );
  }
);
