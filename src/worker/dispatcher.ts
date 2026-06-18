import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  appendContext,
  getTaskBriefing,
  listTasks,
  postExecutionResult,
  updateTaskStatus
} from "../hub/store.js";
import type { HubTask } from "../hub/types.js";
import { spaceDataDir, workspaceRoot } from "../hub/config.js";

export interface WorkerRunOptions {
  projectRoot: string;
  tag?: string;
  limit?: number;
  dryRun?: boolean;
  codexCommand?: string[];
  model?: string;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  approval?: "untrusted" | "on-request" | "never";
}

export interface WorkerRunResult {
  ok: boolean;
  status: "idle" | "dry-run" | "executed" | "locked";
  task?: HubTask;
  exitCode?: number;
  detail?: string;
}

const defaultTag = "codex-auto";

export async function runWorkerOnce(options: WorkerRunOptions): Promise<WorkerRunResult> {
  const lock = await acquireWorkerLock();
  if (!lock.acquired) {
    return { ok: true, status: "locked", detail: lock.detail };
  }

  try {
    const task = await findNextTask(options);
    if (!task) {
      return { ok: true, status: "idle", detail: `No open task tagged ${options.tag ?? defaultTag}.` };
    }

    if (options.dryRun) {
      return { ok: true, status: "dry-run", task, detail: "Matched task but did not execute because dryRun is true." };
    }

    return await executeTask(task, options);
  } finally {
    await releaseWorkerLock(lock.path).catch((error: unknown) => {
      console.error(`Warning: failed to release worker lock ${lock.path}: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}

async function findNextTask(options: WorkerRunOptions) {
  const tag = options.tag ?? defaultTag;
  const tasks = await listTasks({ limit: options.limit ?? 50 });
  return tasks.find((task) => (task.status === "open" || task.status === "planned") && task.tags.includes(tag));
}

async function executeTask(task: HubTask, options: WorkerRunOptions): Promise<WorkerRunResult> {
  await updateTaskStatus({ taskId: task.id, status: "executing" });
  await appendContext({
    taskId: task.id,
    kind: "log",
    actor: "codex",
    source: "codex-worker",
    text: `Codex worker claimed task ${task.id} from memory space ${spaceDataDir}.`
  });

  const promptPath = await writeTaskPrompt(task);
  const args = buildWrappedCodexCommand(task, promptPath, options);
  const startedAt = Date.now();
  const child = spawn(process.execPath, args, {
    cwd: options.projectRoot,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    stdout += text;
    process.stdout.write(text);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    stderr += text;
    process.stderr.write(text);
  });

  const exitCode = await new Promise<number>((resolvePromise, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolvePromise(code ?? 1));
  });
  const durationMs = Date.now() - startedAt;
  const tail = [tailText(stdout, 6000), tailText(stderr, 6000)].filter(Boolean).join("\n\n--- stderr ---\n");
  const passed = exitCode === 0;

  await postExecutionResult({
    taskId: task.id,
    actor: "codex",
    status: passed ? "done" : "blocked",
    summary: passed ? `Codex worker completed task ${task.id}.` : `Codex worker stopped on task ${task.id} with exit code ${exitCode}.`,
    details: [
      `Command: ${[process.execPath, ...args].join(" ")}`,
      `Duration: ${durationMs} ms`,
      `Prompt: ${promptPath}`,
      tail ? `Output tail:\n${tail}` : undefined
    ]
      .filter(Boolean)
      .join("\n\n")
  });

  return {
    ok: passed,
    status: "executed",
    task,
    exitCode,
    detail: passed ? "Task completed." : "Task marked blocked after non-zero Codex exit."
  };
}

async function writeTaskPrompt(task: HubTask) {
  const briefing = await getTaskBriefing(task.id);
  const workerDir = path.join(spaceDataDir, "worker", "prompts");
  await mkdir(workerDir, { recursive: true });
  const promptPath = path.join(workerDir, `${task.id}.${Date.now()}.md`);
  await writeFile(promptPath, renderTaskPrompt(briefing), "utf8");
  return promptPath;
}

function renderTaskPrompt(briefing: Awaited<ReturnType<typeof getTaskBriefing>>) {
  return [
    "You are Codex running from Codex-ChatGPT-Hub's local auto worker.",
    "",
    "Role split:",
    "- ChatGPT is the planner/decision maker that created this task in the shared Hub.",
    "- Codex is the executor. Carry out the task using the local workspace.",
    "",
    "Execution rules:",
    "- Work in the configured workspace.",
    "- Do not push to GitHub unless the task explicitly asks for it.",
    "- Keep changes scoped to the task.",
    "- Run focused verification when practical.",
    "- Record meaningful outcomes in the Hub if you use available MCP tools.",
    "",
    "Task briefing JSON:",
    "```json",
    JSON.stringify(briefing, null, 2),
    "```"
  ].join("\n");
}

function buildWrappedCodexCommand(task: HubTask, promptPath: string, options: WorkerRunOptions) {
  const codexArgs = [
    "exec",
    "--cd",
    workspaceRoot,
    "--sandbox",
    options.sandbox ?? "workspace-write"
  ];

  if (options.model) {
    codexArgs.push("--model", options.model);
  }

  codexArgs.push("-");

  return [
    path.join(options.projectRoot, "dist", "cli.js"),
    "run",
    "--task-id",
    task.id,
    "--title",
    `Codex auto: ${task.title}`,
    "--cwd",
    workspaceRoot,
    "--stdin-file",
    promptPath,
    "--",
    ...(options.codexCommand ?? ["codex"]),
    ...codexArgs
  ];
}

async function acquireWorkerLock() {
  const lockPath = path.join(spaceDataDir, "worker", "codex-worker.lock.json");
  await mkdir(path.dirname(lockPath), { recursive: true });

  try {
    const handle = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
    await handle.writeFile(
      `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), spaceDataDir }, null, 2)}\n`,
      "utf8"
    );
    await handle.close();
    return { acquired: true as const, path: lockPath };
  } catch (error: unknown) {
    const existing = await readLock(lockPath);
    if (existing?.pid && !isProcessRunning(existing.pid)) {
      await rm(lockPath, { force: true });
      return acquireWorkerLock();
    }

    return {
      acquired: false as const,
      path: lockPath,
      detail: existing?.pid ? `Worker lock is held by pid ${existing.pid}.` : `Worker lock exists at ${lockPath}.`
    };
  }
}

async function readLock(lockPath: string) {
  const raw = await readFile(lockPath, "utf8").catch(() => undefined);
  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw) as { pid?: number };
  } catch {
    return undefined;
  }
}

async function releaseWorkerLock(lockPath: string) {
  await rm(lockPath, { force: true }).catch(() => undefined);
}

function isProcessRunning(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function tailText(text: string, maxChars: number) {
  return text.length <= maxChars ? text : text.slice(text.length - maxChars);
}
