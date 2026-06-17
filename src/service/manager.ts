import { existsSync } from "node:fs";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

export interface HubHttpEnv {
  MCP_HUB_DATA_DIR: string;
  MCP_HUB_WORKSPACE: string;
  MCP_HUB_HTTP_HOST: string;
  MCP_HUB_HTTP_PORT: string;
  MCP_HUB_HTTP_TOKEN?: string;
  MCP_HUB_PUBLIC_URL?: string;
}

export interface ServicePaths {
  projectRoot: string;
  dataDir: string;
  pidPath: string;
  logPath: string;
  errorLogPath: string;
}

export interface ServiceStatus {
  configured: {
    host: string;
    port: number;
    localUrl: string;
    healthUrl: string;
    token: "set" | "missing";
    publicUrl?: string;
  };
  paths: ServicePaths;
  process?: ServicePidFile;
  running: boolean;
  managed: boolean;
  stalePid: boolean;
  health?: {
    ok: boolean;
    status?: number;
    detail?: string;
  };
}

interface ServicePidFile {
  pid: number;
  startedAt: string;
  command: string[];
  cwd: string;
  logPath: string;
  errorLogPath: string;
}

export function getServicePaths(projectRoot: string, dataDir: string): ServicePaths {
  const serviceDir = path.join(dataDir, "service");
  return {
    projectRoot,
    dataDir,
    pidPath: path.join(serviceDir, "http.pid.json"),
    logPath: path.join(serviceDir, "http.log"),
    errorLogPath: path.join(serviceDir, "http.err.log")
  };
}

export async function getServiceStatus(projectRoot: string, env: HubHttpEnv): Promise<ServiceStatus> {
  const paths = getServicePaths(projectRoot, env.MCP_HUB_DATA_DIR);
  const processInfo = await readPidFile(paths.pidPath).catch(() => undefined);
  const running = processInfo ? isProcessRunning(processInfo.pid) : false;
  const stalePid = Boolean(processInfo && !running);
  const host = env.MCP_HUB_HTTP_HOST;
  const port = Number.parseInt(env.MCP_HUB_HTTP_PORT, 10);
  const healthUrl = `http://${host}:${port}/health`;
  const status: ServiceStatus = {
    configured: {
      host,
      port,
      localUrl: `http://${host}:${port}/mcp`,
      healthUrl,
      token: env.MCP_HUB_HTTP_TOKEN ? "set" : "missing",
      publicUrl: env.MCP_HUB_PUBLIC_URL
    },
    paths,
    process: processInfo,
    running,
    managed: Boolean(processInfo && running),
    stalePid
  };

  try {
    const response = await fetch(healthUrl);
    status.health = {
      ok: response.ok,
      status: response.status,
      detail: response.statusText
    };
    status.running = status.running || response.ok;
  } catch (error: unknown) {
    status.health = {
      ok: false,
      detail: error instanceof Error ? error.message : String(error)
    };
  }

  return status;
}

export async function startHttpService(projectRoot: string, env: HubHttpEnv) {
  const paths = getServicePaths(projectRoot, env.MCP_HUB_DATA_DIR);
  await mkdir(path.dirname(paths.pidPath), { recursive: true });
  const existingHealth = await pingHealth(env);

  const existing = await readPidFile(paths.pidPath).catch(() => undefined);
  if (existing && isProcessRunning(existing.pid)) {
    return { alreadyRunning: true, pid: existing.pid, paths };
  }

  if (existingHealth.ok) {
    return { alreadyRunning: true, external: true, paths };
  }

  if (existing) {
    await unlink(paths.pidPath).catch(() => undefined);
  }

  const command = [process.execPath, path.join(projectRoot, "dist/http.js")];
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

  const pidFile: ServicePidFile = {
    pid: child.pid ?? 0,
    startedAt: new Date().toISOString(),
    command,
    cwd: projectRoot,
    logPath: paths.logPath,
    errorLogPath: paths.errorLogPath
  };
  await writeFile(paths.pidPath, `${JSON.stringify(pidFile, null, 2)}\n`, "utf8");

  await new Promise((resolve) => setTimeout(resolve, 350));
  if (!child.pid || !isProcessRunning(child.pid)) {
    await unlink(paths.pidPath).catch(() => undefined);
    const errorTail = await readServiceLog(projectRoot, env, "stderr", 4000).catch(() => "");
    throw new Error(`HTTP MCP failed to stay running.${errorTail ? `\n${errorTail}` : ""}`);
  }

  return { alreadyRunning: false, pid: child.pid, paths };
}

export async function stopHttpService(projectRoot: string, env: HubHttpEnv) {
  const paths = getServicePaths(projectRoot, env.MCP_HUB_DATA_DIR);
  const existing = await readPidFile(paths.pidPath).catch(() => undefined);
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

export async function readServiceLog(projectRoot: string, env: HubHttpEnv, kind: "stdout" | "stderr", maxBytes = 8000) {
  const paths = getServicePaths(projectRoot, env.MCP_HUB_DATA_DIR);
  const filePath = kind === "stderr" ? paths.errorLogPath : paths.logPath;
  const stats = await stat(filePath).catch(() => undefined);
  if (!stats) {
    return "";
  }

  const content = await readFile(filePath, "utf8");
  return content.length > maxBytes ? content.slice(content.length - maxBytes) : content;
}

async function readPidFile(pidPath: string): Promise<ServicePidFile> {
  return JSON.parse(await readFile(pidPath, "utf8")) as ServicePidFile;
}

async function pingHealth(env: HubHttpEnv) {
  const host = env.MCP_HUB_HTTP_HOST;
  const port = Number.parseInt(env.MCP_HUB_HTTP_PORT, 10);
  try {
    const response = await fetch(`http://${host}:${port}/health`);
    return { ok: response.ok, status: response.status, detail: response.statusText };
  } catch (error: unknown) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
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
