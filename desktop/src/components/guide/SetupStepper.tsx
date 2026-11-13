import { IconCheck } from "../ui/icons";

export interface SetupStep {
  key: string;
  title: string;
  description: string;
  state: "done" | "current" | "upcoming";
}

interface SetupStepperProps {
  steps: SetupStep[];
}

export function SetupStepper({ steps }: SetupStepperProps) {
  return (
    <div className="setup-stepper">
      <ol className="setup-steps">
        {steps.map((step, index) => (
          <li
            key={step.key}
            className={"setup-step is-" + step.state}
            aria-current={step.state === "current" ? "step" : undefined}
          >
            <span className="setup-step-marker" aria-hidden>
              {step.state === "done" ? (
                <IconCheck size={14} />
              ) : (
                <span className="num">{index + 1}</span>
              )}
            </span>
            <span className="setup-step-copy">
              <span className="setup-step-title">{step.title}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
