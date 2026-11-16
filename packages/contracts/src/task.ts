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

export type TaskState = {
  id: string;
  status: TaskStatus;
  attempt: number;
  updatedAt: string;
};

export interface AgentTask extends TaskState {
  description: string;
  createdAt: string;
}

export const PLAN_STEP_STATUSES = [
  'pending',
  'in_progress',
  'completed',
  'failed',
  'skipped',
] as const;

export type PlanStepStatus = (typeof PLAN_STEP_STATUSES)[number];

export type TaskPlanStep = {
  id: string;
  title: string;
  instruction: string;
  status: PlanStepStatus;
};

export type TaskPlan = {
  taskId: string;
  revision: number;
  summary: string;
  steps: TaskPlanStep[];
  createdAt: string;
};
