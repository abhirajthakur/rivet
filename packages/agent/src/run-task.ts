import type { AgentTask, TaskPlan, TaskState, TaskStatus } from '@rivet/contracts';
import type { AIProvider } from '@rivet/ai';
import { DockerSandboxRunner } from '@rivet/sandbox';
import {
  applyPatch,
  listFiles,
  openWorkspace,
  readFile,
  searchCode,
  writeFile,
  type Workspace,
} from '@rivet/tools';
import type { RunCommandResult } from '@rivet/sandbox';
import { runAgentToolLoop } from './tool-loop.js';
import type {
  AgentTaskToolLoopInput,
  AgentToolCallEvent,
  AgentToolCallStartEvent,
  AgentToolLoopResult,
} from './tool-loop.js';
import { transitionTask } from './task-lifecycle.js';

export interface TaskStateStore {
  saveState(state: TaskState): Promise<void>;
  savePlan(plan: TaskPlan): Promise<void>;
  saveToolCallStarted(
    taskId: string,
    attempt: number,
    event: AgentToolCallStartEvent,
  ): Promise<void>;
  saveToolCall(taskId: string, attempt: number, event: AgentToolCallEvent): Promise<void>;
  isCancellationRequested(taskId: string): Promise<boolean>;
}

export interface AgentOperations {
  initialize(task: AgentTask, workspacePath: string, signal?: AbortSignal): Promise<void>;
  createPlan(
    task: AgentTask,
    tools: AgentTaskTools,
    provider: AIProvider,
    signal?: AbortSignal,
  ): Promise<TaskPlan>;
  execute(
    task: AgentTask,
    plan: TaskPlan,
    tools: AgentTaskTools,
    provider: AIProvider,
    signal?: AbortSignal,
  ): Promise<void>;
  runTests(
    task: AgentTask,
    plan: TaskPlan,
    tools: AgentTaskTools,
    provider: AIProvider,
    signal?: AbortSignal,
  ): Promise<void>;
  review(
    task: AgentTask,
    plan: TaskPlan,
    provider: AIProvider,
    signal?: AbortSignal,
  ): Promise<void>;
}

export type AgentTaskTools = {
  workspace: Workspace;
  listFiles: (input: unknown) => ReturnType<typeof listFiles>;
  readFile: (input: unknown) => ReturnType<typeof readFile>;
  searchCode: (input: unknown) => ReturnType<typeof searchCode>;
  writeFile: (input: unknown) => ReturnType<typeof writeFile>;
  applyPatch: (input: unknown) => ReturnType<typeof applyPatch>;
  runCommand: (input: unknown, signal?: AbortSignal) => Promise<RunCommandResult>;
  runToolLoop: (input: AgentTaskToolLoopInput) => Promise<AgentToolLoopResult>;
};

export type AgentTaskRunResult =
  | { outcome: 'awaiting_approval'; task: AgentTask; plan: TaskPlan }
  | { outcome: 'cancelled'; task: AgentTask }
  | { outcome: 'failed'; task: AgentTask; error: string }
  | { outcome: 'rejected'; task: AgentTask; error: string };

export type RunAgentTaskInput = {
  task: AgentTask;
  workspacePath: string;
  provider: AIProvider;
  stateStore: TaskStateStore;
  operations: AgentOperations;
  signal?: AbortSignal;
};

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
    await input.operations.initialize(task, input.workspacePath, input.signal);

    const workspace = await openWorkspace(input.workspacePath);
    const sandbox = await DockerSandboxRunner.create({ workspacePath: workspace.rootDirectory });
    const toolSet = {
      listFiles: (toolInput: unknown) => listFiles(workspace, toolInput),
      readFile: (toolInput: unknown) => readFile(workspace, toolInput),
      searchCode: (toolInput: unknown) => searchCode(workspace, toolInput),
      writeFile: (toolInput: unknown) => writeFile(workspace, toolInput),
      applyPatch: (toolInput: unknown) => applyPatch(workspace, toolInput),
      runCommand: (toolInput: unknown, signal?: AbortSignal) =>
        sandbox.runCommand(toolInput, signal ?? input.signal),
    };
    const tools: AgentTaskTools = {
      workspace,
      ...toolSet,
      runToolLoop: (loopInput) =>
        runAgentToolLoop({
          ...loopInput,
          provider: input.provider,
          tools: toolSet,
          ...((loopInput.signal ?? input.signal)
            ? { signal: loopInput.signal ?? input.signal }
            : {}),
          onToolCallStart: (event) =>
            input.stateStore.saveToolCallStarted(task.id, task.attempt, event),
          onToolCall: (event) => input.stateStore.saveToolCall(task.id, task.attempt, event),
        }),
    };

    if (await cancelIfRequested()) return { outcome: 'cancelled', task };
    await moveTo('planning');
    plan = await input.operations.createPlan(task, tools, input.provider, input.signal);
    await input.stateStore.savePlan(plan);

    if (await cancelIfRequested()) return { outcome: 'cancelled', task };
    await moveTo('executing');
    await input.operations.execute(task, plan, tools, input.provider, input.signal);

    if (await cancelIfRequested()) return { outcome: 'cancelled', task };
    await moveTo('testing');
    await input.operations.runTests(task, plan, tools, input.provider, input.signal);

    if (await cancelIfRequested()) return { outcome: 'cancelled', task };
    await moveTo('reviewing');
    await input.operations.review(task, plan, input.provider, input.signal);

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
