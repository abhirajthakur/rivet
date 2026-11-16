export const TASK_STATUSES = [
  'pending',
  'queued',
  'initializing',
  'planning',
  'executing',
  'testing',
  'reviewing',
  'awaiting_approval',
  'completed',
  'failed',
  'cancelled',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface TaskState {
  readonly id: string;
  readonly status: TaskStatus;
  readonly attempt: number;
  readonly updatedAt: string;
}

export interface AgentTask extends TaskState {
  readonly description: string;
  readonly createdAt: string;
}

export const PLAN_STEP_STATUSES = [
  'pending',
  'in_progress',
  'completed',
  'failed',
  'skipped',
] as const;

export type PlanStepStatus = (typeof PLAN_STEP_STATUSES)[number];

export interface TaskPlanStep {
  readonly id: string;
  readonly title: string;
  readonly instruction: string;
  readonly status: PlanStepStatus;
}

export interface TaskPlan {
  readonly taskId: string;
  readonly revision: number;
  readonly summary: string;
  readonly steps: readonly TaskPlanStep[];
  readonly createdAt: string;
}
