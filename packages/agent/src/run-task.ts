import type { AgentTask, TaskPlan, TaskState, TaskStatus } from '@rivet/contracts';
import { transitionTask } from './task-lifecycle.js';

export interface TaskStateStore {
  saveState(state: TaskState): Promise<void>;
  savePlan(plan: TaskPlan): Promise<void>;
  isCancellationRequested(taskId: string): Promise<boolean>;
}

export interface AgentOperations {
  initialize(task: AgentTask, signal?: AbortSignal): Promise<void>;
  createPlan(task: AgentTask, signal?: AbortSignal): Promise<TaskPlan>;
  execute(task: AgentTask, plan: TaskPlan, signal?: AbortSignal): Promise<void>;
  runTests(task: AgentTask, plan: TaskPlan, signal?: AbortSignal): Promise<void>;
  review(task: AgentTask, plan: TaskPlan, signal?: AbortSignal): Promise<void>;
}

export type AgentTaskRunResult =
  | { readonly outcome: 'awaiting_approval'; readonly task: AgentTask; readonly plan: TaskPlan }
  | { readonly outcome: 'cancelled'; readonly task: AgentTask }
  | { readonly outcome: 'failed'; readonly task: AgentTask; readonly error: string }
  | { readonly outcome: 'rejected'; readonly task: AgentTask; readonly error: string };

export interface RunAgentTaskInput {
  readonly task: AgentTask;
  readonly stateStore: TaskStateStore;
  readonly operations: AgentOperations;
  readonly signal?: AbortSignal;
}

export async function runAgentTask(input: RunAgentTaskInput): Promise<AgentTaskRunResult> {
  let task = input.task;
  let plan: TaskPlan | undefined;

  const moveTo = async (status: TaskStatus): Promise<void> => {
    const transition = transitionTask(task, status);
    if (!transition.ok) {
      throw new Error(`Invalid task transition: ${task.status} -> ${status}`);
    }

    await input.stateStore.saveState(transition.state);
    task = { ...task, ...transition.state };
  };

  const cancelIfRequested = async (): Promise<boolean> => {
    const cancelled =
      input.signal?.aborted || (await input.stateStore.isCancellationRequested(task.id));
    if (!cancelled) return false;

    await moveTo('cancelled');
    return true;
  };

  try {
    if (task.status !== 'queued') {
      return {
        outcome: 'rejected',
        task,
        error: `Agent tasks must start queued; received ${task.status}.`,
      };
    }

    if (await cancelIfRequested()) return { outcome: 'cancelled', task };
    await moveTo('initializing');
    await input.operations.initialize(task, input.signal);

    if (await cancelIfRequested()) return { outcome: 'cancelled', task };
    await moveTo('planning');
    plan = await input.operations.createPlan(task, input.signal);
    await input.stateStore.savePlan(plan);

    if (await cancelIfRequested()) return { outcome: 'cancelled', task };
    await moveTo('executing');
    await input.operations.execute(task, plan, input.signal);

    if (await cancelIfRequested()) return { outcome: 'cancelled', task };
    await moveTo('testing');
    await input.operations.runTests(task, plan, input.signal);

    if (await cancelIfRequested()) return { outcome: 'cancelled', task };
    await moveTo('reviewing');
    await input.operations.review(task, plan, input.signal);

    if (await cancelIfRequested()) return { outcome: 'cancelled', task };
    await moveTo('awaiting_approval');

    return { outcome: 'awaiting_approval', task, plan };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Agent run failed with an unknown error.';

    if (input.signal?.aborted) {
      if (task.status !== 'cancelled') await moveTo('cancelled');
      return { outcome: 'cancelled', task };
    }

    if (task.status !== 'failed' && task.status !== 'cancelled' && task.status !== 'completed') {
      await moveTo('failed');
    }

    return { outcome: 'failed', task, error: message };
  }
}
