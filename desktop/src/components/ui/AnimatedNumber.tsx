import { useEffect, useState } from "react";
import { useReducedMotion, useSpring } from "motion/react";

interface AnimatedNumberProps {
  value: number;
  digits?: number;
  suffix?: string;
  className?: string;
}

export function AnimatedNumber({
  value,
  digits = 2,
  suffix,
  className,
}: AnimatedNumberProps) {
  const reduced = useReducedMotion();
  const spring = useSpring(value, { stiffness: 120, damping: 24, mass: 0.8 });
  const [text, setText] = useState(value.toFixed(digits));

  useEffect(() => {
    if (reduced) {
      spring.jump(value);
      setText(value.toFixed(digits));
      return;
    }
    spring.set(value);
  }, [value, digits, reduced, spring]);

  useEffect(() => {
    if (reduced) return;
    const un = spring.on("change", (v) => setText(v.toFixed(digits)));
    return () => un();
  }, [spring, digits, reduced]);

  return (
    <span className={["num", className ?? ""].filter(Boolean).join(" ")}>
      {text}
      {suffix ? <span className="animated-suffix">{suffix}</span> : null}
    </span>
  );
}
