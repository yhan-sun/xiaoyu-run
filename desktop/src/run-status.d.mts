export interface RunStatusInput {
  phase: string;
  failed: boolean;
  finished: boolean;
}

export interface RunNotice {
  kind: "info" | "warning" | "success";
  title: string;
  description: string;
  showLogs: boolean;
  needsReview: boolean;
}

export function describeRunStatus(run: RunStatusInput | null, stopping: boolean): RunNotice | null;
