import { useId } from "react";
import { IconMinus, IconPlus } from "../ui/icons";

interface Preset {
  label: string;
  value: string;
}

interface NumberFieldProps {
  label: string;
  value: string;
  unit: string;
  placeholder?: string;
  inputMode?: "text" | "decimal" | "numeric";
  disabled?: boolean;
  error?: string;
  hint?: string;
  presets?: Preset[];
  onValueChange: (value: string) => void;
  onBlur?: () => void;
  onStep: (delta: number) => void;
  ariaLabel?: string;
}

export function NumberField({
  label,
  value,
  unit,
  placeholder,
  inputMode = "text",
  disabled = false,
  error,
  hint,
  presets,
  onValueChange,
  onBlur,
  onStep,
  ariaLabel,
}: NumberFieldProps) {
  const inputId = useId();
  const errorId = useId();

  return (
    <div className={"number-field" + (error ? " has-error" : "")}>
      <div className="number-field-head">
        <label className="t-label" htmlFor={inputId}>
          {label}
        </label>
        {error ? (
          <span className="number-field-error" id={errorId}>
            {error}
          </span>
        ) : null}
      </div>

      <div className="number-field-box">
        <button
          type="button"
          className="stepper"
          aria-label={`${label}减少`}
          disabled={disabled}
          onClick={() => onStep(-1)}
        >
          <IconMinus size={16} />
        </button>
        <input
          id={inputId}
          className="number-field-input num"
          value={value}
          placeholder={placeholder}
          inputMode={inputMode}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          disabled={disabled}
          aria-label={ariaLabel ?? label}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => onValueChange(event.target.value)}
          onBlur={onBlur}
        />
        <span className="number-field-unit">{unit}</span>
        <button
          type="button"
          className="stepper"
          aria-label={`${label}增加`}
          disabled={disabled}
          onClick={() => onStep(1)}
        >
          <IconPlus size={16} />
        </button>
      </div>

      {presets && presets.length > 0 ? (
        <div className="preset-row" aria-label={`${label}快捷选项`}>
          {presets.map((preset) => (
            <button
              key={preset.value}
              type="button"
              className={"preset" + (value === preset.value ? " is-active" : "")}
              disabled={disabled}
              onClick={() => onValueChange(preset.value)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      ) : null}

      {hint && !error ? <div className="number-field-hint">{hint}</div> : null}
    </div>
  );
}
