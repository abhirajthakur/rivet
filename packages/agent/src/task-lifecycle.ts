import type { TaskState, TaskStatus } from '@rivet/contracts';

const ALLOWED_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  pending: ['queued', 'cancelled'],
  queued: ['initializing', 'cancelled'],
  initializing: ['planning', 'failed', 'cancelled'],
  planning: ['executing', 'failed', 'cancelled'],
  executing: ['testing', 'failed', 'cancelled'],
  testing: ['executing', 'reviewing', 'failed', 'cancelled'],
  reviewing: ['awaiting_approval', 'failed', 'cancelled'],
  awaiting_approval: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: ['queued'],
  cancelled: [],
};

export type TaskTransitionError = 'invalid_transition';

export type TaskTransitionResult =
  | { readonly ok: true; readonly state: TaskState }
  | { readonly ok: false; readonly error: TaskTransitionError };

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function transitionTask(
  state: TaskState,
  nextStatus: TaskStatus,
  at: string = new Date().toISOString(),
): TaskTransitionResult {
  if (!canTransitionTask(state.status, nextStatus)) {
    return { ok: false, error: 'invalid_transition' };
  }

  return {
    ok: true,
    state: {
      ...state,
      status: nextStatus,
      attempt: state.attempt + Number(state.status === 'failed' && nextStatus === 'queued'),
      updatedAt: at,
    },
  };
}
