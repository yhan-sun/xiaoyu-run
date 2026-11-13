interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  tone?: "default" | "error";
}

export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  tone = "default",
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-invalid={tone === "error" || undefined}
      disabled={disabled}
      className={[
        "switch",
        checked ? "is-on" : "",
        tone === "error" ? "is-error" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-thumb" aria-hidden />
    </button>
  );
}
