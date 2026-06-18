import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { spaceDataDir, statePath } from "./config.js";
import type {
  HubActor,
  HubContextEntry,
  HubContextKind,
  HubExecutionResult,
  HubExecutionStatus,
  HubPlan,
  HubPlanStatus,
  HubState,
  HubTask,
  HubTaskStatus,
  WorkspaceSnapshot
} from "./types.js";

const maxBriefingItems = 30;

export interface CreateTaskInput {
  title: string;
  description?: string;
  createdBy?: HubActor;
  tags?: string[];
}

export interface AppendContextInput {
  taskId?: string;
  kind?: HubContextKind;
  actor?: HubActor;
  text: string;
  source?: string;
}

export interface PostPlanInput {
  taskId: string;
  actor?: HubActor;
  title?: string;
  plan: string;
  status?: HubPlanStatus;
}

export interface PostExecutionResultInput {
  taskId: string;
  actor?: HubActor;
  status?: HubExecutionStatus;
  summary: string;
  details?: string;
}

export interface AddWorkspaceSnapshotInput {
  actor?: HubActor;
  workspaceRoot: string;
  files: string[];
  branch?: string;
  gitStatus?: string;
  note?: string;
}

export interface ListTasksInput {
  status?: HubTaskStatus;
  limit?: number;
}

export interface UpdateTaskStatusInput {
  taskId: string;
  status: HubTaskStatus;
}

export interface TaskBriefing {
  task: HubTask;
  contexts: HubContextEntry[];
  plans: HubPlan[];
  executionResults: HubExecutionResult[];
  workspaceSnapshots: WorkspaceSnapshot[];
}

export async function createTask(input: CreateTaskInput) {
  const state = await loadState();
  const now = nowIso();
  const task: HubTask = {
    id: createId("task"),
    title: input.title,
    description: input.description ?? "",
    status: "open",
    createdBy: input.createdBy ?? "user",
    createdAt: now,
    updatedAt: now,
    tags: input.tags ?? []
  };

  state.tasks.unshift(task);
  await saveState(state);
  return task;
}

export async function appendContext(input: AppendContextInput) {
  const state = await loadState();
  const entry: HubContextEntry = {
    id: createId("ctx"),
    taskId: input.taskId,
    kind: input.kind ?? "note",
    actor: input.actor ?? "user",
    text: input.text,
    source: input.source,
    createdAt: nowIso()
  };

  if (entry.taskId) {
    touchTask(state, entry.taskId);
  }

  state.contexts.unshift(entry);
  await saveState(state);
  return entry;
}

export async function postPlan(input: PostPlanInput) {
  const state = await loadState();
  assertTaskExists(state, input.taskId);

  const plan: HubPlan = {
    id: createId("plan"),
    taskId: input.taskId,
    actor: input.actor ?? "chatgpt",
    title: input.title ?? "Plan",
    plan: input.plan,
    status: input.status ?? "proposed",
    createdAt: nowIso()
  };

  state.plans.unshift(plan);
  const task = touchTask(state, input.taskId);
  if (task.status === "open") {
    task.status = "planned";
  }

  await saveState(state);
  return plan;
}

export async function postExecutionResult(input: PostExecutionResultInput) {
  const state = await loadState();
  assertTaskExists(state, input.taskId);

  const result: HubExecutionResult = {
    id: createId("run"),
    taskId: input.taskId,
    actor: input.actor ?? "codex",
    status: input.status ?? "progress",
    summary: input.summary,
    details: input.details,
    createdAt: nowIso()
  };

  state.executionResults.unshift(result);
  const task = touchTask(state, input.taskId);

  if (result.status === "done" || result.status === "passed") {
    task.status = "done";
  } else if (result.status === "blocked" || result.status === "failed") {
    task.status = result.status === "blocked" ? "blocked" : "executing";
  } else {
    task.status = "executing";
  }

  await saveState(state);
  return result;
}

export async function updateTaskStatus(input: UpdateTaskStatusInput) {
  const state = await loadState();
  const task = touchTask(state, input.taskId);
  task.status = input.status;
  await saveState(state);
  return task;
}

export async function addWorkspaceSnapshot(input: AddWorkspaceSnapshotInput) {
  const state = await loadState();
  const snapshot: WorkspaceSnapshot = {
    id: createId("snap"),
    actor: input.actor ?? "codex",
    workspaceRoot: input.workspaceRoot,
    createdAt: nowIso(),
    branch: input.branch,
    gitStatus: input.gitStatus,
    files: input.files,
    note: input.note
  };

  state.workspaceSnapshots.unshift(snapshot);
  await saveState(state);
  return snapshot;
}

export async function listTasks(input: ListTasksInput = {}) {
  const state = await loadState();
  const limit = clampLimit(input.limit, 20, 100);
  const tasks = input.status ? state.tasks.filter((task) => task.status === input.status) : state.tasks;
  return tasks.slice(0, limit);
}

export async function getTaskBriefing(taskId: string): Promise<TaskBriefing> {
  const state = await loadState();
  const task = state.tasks.find((candidate) => candidate.id === taskId);

  if (!task) {
    throw new Error(`Unknown task: ${taskId}`);
  }

  return {
    task,
    contexts: state.contexts.filter((entry) => entry.taskId === taskId).slice(0, maxBriefingItems),
    plans: state.plans.filter((plan) => plan.taskId === taskId).slice(0, maxBriefingItems),
    executionResults: state.executionResults
      .filter((result) => result.taskId === taskId)
      .slice(0, maxBriefingItems),
    workspaceSnapshots: state.workspaceSnapshots.slice(0, 5)
  };
}

export async function getHubOverview() {
  const state = await loadState();
  return {
    version: state.version,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    counts: {
      tasks: state.tasks.length,
      contexts: state.contexts.length,
      plans: state.plans.length,
      executionResults: state.executionResults.length,
      workspaceSnapshots: state.workspaceSnapshots.length
    },
    recentTasks: state.tasks.slice(0, 10),
    latestWorkspaceSnapshot: state.workspaceSnapshots[0]
  };
}

export async function loadState(): Promise<HubState> {
  try {
    const raw = await readFile(statePath, "utf8");
    return normalizeState(JSON.parse(raw) as Partial<HubState>);
  } catch (error: unknown) {
    if (isFileMissingError(error)) {
      const state = createEmptyState();
      await saveState(state);
      return state;
    }

    throw error;
  }
}

async function saveState(state: HubState) {
  await mkdir(spaceDataDir, { recursive: true });
  state.updatedAt = nowIso();

  const tempPath = path.join(spaceDataDir, `hub-state.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tempPath, statePath);
}

function createEmptyState(): HubState {
  const now = nowIso();
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    tasks: [],
    contexts: [],
    plans: [],
    executionResults: [],
    workspaceSnapshots: []
  };
}

function normalizeState(state: Partial<HubState>): HubState {
  return {
    version: 1,
    createdAt: state.createdAt ?? nowIso(),
    updatedAt: state.updatedAt ?? state.createdAt ?? nowIso(),
    tasks: state.tasks ?? [],
    contexts: state.contexts ?? [],
    plans: state.plans ?? [],
    executionResults: state.executionResults ?? [],
    workspaceSnapshots: state.workspaceSnapshots ?? []
  };
}

function assertTaskExists(state: HubState, taskId: string) {
  if (!state.tasks.some((task) => task.id === taskId)) {
    throw new Error(`Unknown task: ${taskId}`);
  }
}

function touchTask(state: HubState, taskId: string) {
  const task = state.tasks.find((candidate) => candidate.id === taskId);

  if (!task) {
    throw new Error(`Unknown task: ${taskId}`);
  }

  task.updatedAt = nowIso();
  return task;
}

function clampLimit(limit: number | undefined, fallback: number, max: number) {
  if (!Number.isFinite(limit)) {
    return fallback;
  }

  return Math.min(Math.max(Math.trunc(limit ?? fallback), 1), max);
}

function createId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function isFileMissingError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
