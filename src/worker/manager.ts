import { existsSync } from "node:fs";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

import { resolveSpaceDataDir } from "../hub/config.js";
import { readJsonFile } from "../utils/json.js";

export interface WorkerServiceEnv {
  MCP_HUB_DATA_DIR: string;
  MCP_HUB_MEMORY_SPACE?: string;
  MCP_HUB_WORKSPACE: string;
}

export interface WorkerStartOptions {
  intervalMs?: number;
  tag?: string;
  dryRun?: boolean;
  codexCommand?: string[];
  model?: string;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  approval?: "untrusted" | "on-request" | "never";
}

export interface WorkerPaths {
  workerDir: string;
  pidPath: string;
  logPath: string;
  errorLogPath: string;
}

export interface WorkerPidFile {
  pid: number;
  startedAt: string;
  command: string[];
  cwd: string;
  memorySpace: string;
  intervalMs: number;
  tag?: string;
  dryRun?: boolean;
  logPath: string;
  errorLogPath: string;
  mode?: "background" | "foreground";
}

export function getWorkerPaths(env: WorkerServiceEnv): WorkerPaths {
  const space = env.MCP_HUB_MEMORY_SPACE ?? "default";
  const spaceRoot = resolveSpaceDataDir(env.MCP_HUB_DATA_DIR, space);
  const workerDir = path.join(spaceRoot, "worker");
  return {
    workerDir,
    pidPath: path.join(workerDir, "codex-worker.pid.json"),
    logPath: path.join(workerDir, "codex-worker.log"),
    errorLogPath: path.join(workerDir, "codex-worker.err.log")
  };
}

export async function startWorkerService(projectRoot: string, env: WorkerServiceEnv, options: WorkerStartOptions = {}) {
  const paths = getWorkerPaths(env);
  await mkdir(paths.workerDir, { recursive: true });
  const existing = await readWorkerPid(paths.pidPath).catch(() => undefined);

  if (existing && isProcessRunning(existing.pid)) {
    return { alreadyRunning: true, pid: existing.pid, paths };
  }

  if (existing) {
    await unlink(paths.pidPath).catch(() => undefined);
  }

  const intervalMs = options.intervalMs ?? 15_000;
  const command = [
    process.execPath,
    path.join(projectRoot, "dist/cli.js"),
    "worker",
    "foreground",
    "--interval-ms",
    String(intervalMs)
  ];

  if (options.tag) {
    command.push("--tag", options.tag);
  }
  if (options.dryRun) {
    command.push("--dry-run");
  }
  if (options.codexCommand) {
    for (const part of options.codexCommand) {
      command.push("--codex-command", part);
    }
  }
  if (options.model) {
    command.push("--model", options.model);
  }
  if (options.sandbox) {
    command.push("--sandbox", options.sandbox);
  }
  if (options.approval) {
    command.push("--approval", options.approval);
  }

  const out = await openAppend(paths.logPath);
  const err = await openAppend(paths.errorLogPath);
  const child = spawn(command[0]!, command.slice(1), {
    cwd: projectRoot,
    detached: true,
    env: { ...process.env, ...env },
    stdio: ["ignore", out.fd, err.fd]
  });
  child.unref();
  await out.close();
  await err.close();

  const pidFile: WorkerPidFile = {
    pid: child.pid ?? 0,
    startedAt: new Date().toISOString(),
    command,
    cwd: projectRoot,
    memorySpace: env.MCP_HUB_MEMORY_SPACE ?? "default",
    intervalMs,
    tag: options.tag,
    dryRun: options.dryRun,
    logPath: paths.logPath,
    errorLogPath: paths.errorLogPath,
    mode: "background"
  };
  await writeFile(paths.pidPath, `${JSON.stringify(pidFile, null, 2)}\n`, "utf8");

  await new Promise((resolve) => setTimeout(resolve, 350));
  if (!child.pid || !isProcessRunning(child.pid)) {
    await unlink(paths.pidPath).catch(() => undefined);
    const errorTail = await readWorkerLog(env, "stderr", 4000).catch(() => "");
    throw new Error(`Codex worker failed to stay running.${errorTail ? `\n${errorTail}` : ""}`);
  }

  return { alreadyRunning: false, pid: child.pid, paths };
}

export async function writeWorkerPidFile(
  projectRoot: string,
  env: WorkerServiceEnv,
  options: {
    pid: number;
    command: string[];
    intervalMs: number;
    tag?: string;
    dryRun?: boolean;
    mode: "background" | "foreground";
  }
) {
  const paths = getWorkerPaths(env);
  await mkdir(paths.workerDir, { recursive: true });

  const existing = await readWorkerPid(paths.pidPath).catch(() => undefined);
  if (existing && existing.pid !== options.pid && isProcessRunning(existing.pid)) {
    throw new Error(`Codex worker is already running (pid ${existing.pid}). Stop it before starting another worker.`);
  }
  if (existing && !isProcessRunning(existing.pid)) {
    await unlink(paths.pidPath).catch(() => undefined);
  }

  const pidFile: WorkerPidFile = {
    pid: options.pid,
    startedAt: new Date().toISOString(),
    command: options.command,
    cwd: projectRoot,
    memorySpace: env.MCP_HUB_MEMORY_SPACE ?? "default",
    intervalMs: options.intervalMs,
    tag: options.tag,
    dryRun: options.dryRun,
    logPath: paths.logPath,
    errorLogPath: paths.errorLogPath,
    mode: options.mode
  };
  await writeFile(paths.pidPath, `${JSON.stringify(pidFile, null, 2)}\n`, "utf8");

  return paths;
}

export async function clearWorkerPidFile(env: WorkerServiceEnv, pid = process.pid) {
  const paths = getWorkerPaths(env);
  const existing = await readWorkerPid(paths.pidPath).catch(() => undefined);

  if (!existing || existing.pid === pid || !isProcessRunning(existing.pid)) {
    await unlink(paths.pidPath).catch(() => undefined);
  }

  return paths;
}

export async function stopWorkerService(env: WorkerServiceEnv) {
  const paths = getWorkerPaths(env);
  const existing = await readWorkerPid(paths.pidPath).catch(() => undefined);
  if (!existing) {
    return { stopped: false, reason: "No pid file.", paths };
  }

  if (!isProcessRunning(existing.pid)) {
    await unlink(paths.pidPath).catch(() => undefined);
    return { stopped: false, reason: "Pid file was stale.", pid: existing.pid, paths };
  }

  process.kill(existing.pid, "SIGTERM");
  const stopped = await waitForExit(existing.pid, 3000);
  if (!stopped && isProcessRunning(existing.pid)) {
    process.kill(existing.pid, "SIGKILL");
  }
  await unlink(paths.pidPath).catch(() => undefined);

  return { stopped: true, pid: existing.pid, paths };
}

export async function getWorkerStatus(env: WorkerServiceEnv) {
  const paths = getWorkerPaths(env);
  const processInfo = await readWorkerPid(paths.pidPath).catch(() => undefined);
  const running = processInfo ? isProcessRunning(processInfo.pid) : false;
  return {
    memorySpace: env.MCP_HUB_MEMORY_SPACE ?? "default",
    paths,
    process: processInfo,
    running,
    stalePid: Boolean(processInfo && !running)
  };
}

export async function readWorkerLog(env: WorkerServiceEnv, kind: "stdout" | "stderr", maxBytes = 8000) {
  const paths = getWorkerPaths(env);
  const filePath = kind === "stderr" ? paths.errorLogPath : paths.logPath;
  const stats = await stat(filePath).catch(() => undefined);
  if (!stats) {
    return "";
  }

  const content = await readFile(filePath, "utf8");
  return content.length > maxBytes ? content.slice(content.length - maxBytes) : content;
}

async function readWorkerPid(pidPath: string): Promise<WorkerPidFile> {
  return readJsonFile<WorkerPidFile>(pidPath);
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

async function waitForExit(pid: number, timeoutMs: number) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!isProcessRunning(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return !isProcessRunning(pid);
}

async function openAppend(filePath: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  if (!existsSync(filePath)) {
    await writeFile(filePath, "", "utf8");
  }
  return import("node:fs/promises").then((fs) => fs.open(filePath, "a"));
}
