import { existsSync } from "node:fs";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { getServiceStatus, startHttpService, stopHttpService, type HubHttpEnv } from "../service/manager.js";

export interface TunnelPaths {
  dataDir: string;
  tunnelDir: string;
  pidPath: string;
  watcherPidPath: string;
  logPath: string;
  errorLogPath: string;
  watcherLogPath: string;
}

export interface NgrokTunnelStatus {
  installed: boolean;
  binary: string;
  running: boolean;
  pid?: number;
  publicUrl?: string;
  connectorUrl?: string;
  localMcpUrl: string;
  dashboardPublicUrl?: string;
  health: {
    mcp: boolean;
    ngrokApi: boolean;
  };
  paths: TunnelPaths;
  install: NgrokInstallInfo;
}

export interface NgrokInstallInfo {
  platform: NodeJS.Platform;
  arch: string;
  supported: boolean;
  recommended: string[];
  links: Array<{ label: string; url: string }>;
}

interface PidFile {
  pid: number;
  startedAt: string;
  command: string[];
  cwd: string;
  logPath: string;
  errorLogPath: string;
}

interface EnsureTunnelInput {
  projectRoot: string;
  env: HubHttpEnv;
  envPath: string;
  restartHttpOnUrlChange?: boolean;
}

const defaultNgrokApi = "http://127.0.0.1:4040/api/tunnels";

export function getTunnelPaths(dataDir: string): TunnelPaths {
  const tunnelDir = path.join(dataDir, "ngrok");
  return {
    dataDir,
    tunnelDir,
    pidPath: path.join(tunnelDir, "ngrok.pid.json"),
    watcherPidPath: path.join(tunnelDir, "watcher.pid.json"),
    logPath: path.join(tunnelDir, "ngrok.log"),
    errorLogPath: path.join(tunnelDir, "ngrok.err.log"),
    watcherLogPath: path.join(tunnelDir, "watcher.log")
  };
}

export async function getNgrokStatus(projectRoot: string, env: HubHttpEnv): Promise<NgrokTunnelStatus> {
  const paths = getTunnelPaths(env.MCP_HUB_DATA_DIR);
  const installed = await isNgrokInstalled();
  const pidFile = await readPidFile(paths.pidPath).catch(() => undefined);
  const pidRunning = pidFile ? isProcessRunning(pidFile.pid) : false;
  const tunnels = await readNgrokTunnels().catch(() => undefined);
  const publicUrl = findHttpsTunnelUrl(tunnels);
  const mcpStatus = await getServiceStatus(projectRoot, env);

  return {
    installed,
    binary: process.env.NGROK_BIN ?? "ngrok",
    running: Boolean(pidRunning || publicUrl),
    pid: pidRunning ? pidFile?.pid : undefined,
    publicUrl,
    connectorUrl: publicUrl ? withMcpPath(publicUrl) : undefined,
    localMcpUrl: `http://${env.MCP_HUB_HTTP_HOST}:${env.MCP_HUB_HTTP_PORT}/mcp`,
    dashboardPublicUrl: env.MCP_HUB_PUBLIC_URL,
    health: {
      mcp: mcpStatus.health?.ok === true,
      ngrokApi: Boolean(tunnels)
    },
    paths,
    install: getNgrokInstallInfo()
  };
}

export async function configureNgrokAuthtoken(token: string) {
  if (!token.trim()) {
    throw new Error("Missing ngrok authtoken.");
  }

  await runNgrok(["config", "add-authtoken", token], { redact: token });
}

export async function installNgrokIfPossible(printOnly = false) {
  const installed = await isNgrokInstalled();
  const info = getNgrokInstallInfo();

  if (installed || printOnly) {
    return {
      installed,
      attempted: false,
      info,
      message: installed ? "ngrok is already installed." : "Printed install instructions only."
    };
  }

  if (process.platform === "darwin" && (await commandExists("brew"))) {
    await runCommand("brew", ["install", "ngrok"]);
    return {
      installed: await isNgrokInstalled(),
      attempted: true,
      info,
      message: "Installed ngrok with Homebrew."
    };
  }

  return {
    installed: false,
    attempted: false,
    info,
    message: "Automatic install is not available for this platform. Use the printed official install command/link."
  };
}

export async function ensureNgrokTunnel(input: EnsureTunnelInput) {
  const statusBefore = await getNgrokStatus(input.projectRoot, input.env);
  if (!statusBefore.health.mcp) {
    await startHttpService(input.projectRoot, input.env);
  }

  if (!statusBefore.installed) {
    throw new Error("ngrok is not installed. Run: npm run tunnel -- install");
  }

  if (!statusBefore.publicUrl) {
    await stopNgrokTunnel(input.env).catch(() => undefined);
    await startNgrokTunnel(input.projectRoot, input.env);
  }

  const statusAfter = await waitForPublicUrl(input.projectRoot, input.env, 12_000);
  if (!statusAfter.publicUrl) {
    throw new Error("ngrok started but no HTTPS public URL was discovered.");
  }

  const changed = await upsertEnvValue(input.envPath, "MCP_HUB_PUBLIC_URL", statusAfter.publicUrl);
  if (changed && input.restartHttpOnUrlChange !== false) {
    const nextEnv = {
      ...input.env,
      MCP_HUB_PUBLIC_URL: statusAfter.publicUrl
    };
    await stopHttpService(input.projectRoot, nextEnv).catch(() => undefined);
    await startHttpService(input.projectRoot, nextEnv);
  }

  return {
    ...statusAfter,
    envUpdated: changed
  };
}

export async function startNgrokTunnel(projectRoot: string, env: HubHttpEnv) {
  const paths = getTunnelPaths(env.MCP_HUB_DATA_DIR);
  await mkdir(paths.tunnelDir, { recursive: true });

  const existing = await readPidFile(paths.pidPath).catch(() => undefined);
  if (existing && isProcessRunning(existing.pid)) {
    return { alreadyRunning: true, pid: existing.pid, paths };
  }

  if (existing) {
    await unlink(paths.pidPath).catch(() => undefined);
  }

  const command = [
    process.env.NGROK_BIN ?? "ngrok",
    "http",
    env.MCP_HUB_HTTP_PORT,
    "--log=stdout",
    "--log-format=json"
  ];
  const out = await openAppend(paths.logPath);
  const err = await openAppend(paths.errorLogPath);
  const child = spawn(command[0]!, command.slice(1), {
    cwd: projectRoot,
    detached: true,
    env: process.env,
    stdio: ["ignore", out.fd, err.fd]
  });
  child.unref();
  await out.close();
  await err.close();

  const pidFile: PidFile = {
    pid: child.pid ?? 0,
    startedAt: new Date().toISOString(),
    command,
    cwd: projectRoot,
    logPath: paths.logPath,
    errorLogPath: paths.errorLogPath
  };
  await writeFile(paths.pidPath, `${JSON.stringify(pidFile, null, 2)}\n`, "utf8");

  await new Promise((resolve) => setTimeout(resolve, 600));
  if (!child.pid || !isProcessRunning(child.pid)) {
    await unlink(paths.pidPath).catch(() => undefined);
    const errorTail = await readLog(paths.errorLogPath, 4000).catch(() => "");
    throw new Error(`ngrok failed to stay running.${errorTail ? `\n${errorTail}` : ""}`);
  }

  return { alreadyRunning: false, pid: child.pid, paths };
}

export async function stopNgrokTunnel(env: HubHttpEnv) {
  const paths = getTunnelPaths(env.MCP_HUB_DATA_DIR);
  const existing = await readPidFile(paths.pidPath).catch(() => undefined);
  if (!existing) {
    return { stopped: false, reason: "No ngrok pid file.", paths };
  }

  if (!isProcessRunning(existing.pid)) {
    await unlink(paths.pidPath).catch(() => undefined);
    return { stopped: false, reason: "ngrok pid file was stale.", pid: existing.pid, paths };
  }

  process.kill(existing.pid, "SIGTERM");
  const stopped = await waitForExit(existing.pid, 3000);
  if (!stopped && isProcessRunning(existing.pid)) {
    process.kill(existing.pid, "SIGKILL");
  }
  await unlink(paths.pidPath).catch(() => undefined);

  return { stopped: true, pid: existing.pid, paths };
}

export async function startTunnelWatcher(projectRoot: string, env: HubHttpEnv) {
  const paths = getTunnelPaths(env.MCP_HUB_DATA_DIR);
  await mkdir(paths.tunnelDir, { recursive: true });

  const existing = await readPidFile(paths.watcherPidPath).catch(() => undefined);
  if (existing && isProcessRunning(existing.pid)) {
    return { alreadyRunning: true, pid: existing.pid, paths };
  }

  const command = [process.execPath, path.join(projectRoot, "dist/cli.js"), "tunnel", "watch"];
  const out = await openAppend(paths.watcherLogPath);
  const child = spawn(command[0]!, command.slice(1), {
    cwd: projectRoot,
    detached: true,
    env: process.env,
    stdio: ["ignore", out.fd, out.fd]
  });
  child.unref();
  await out.close();

  const pidFile: PidFile = {
    pid: child.pid ?? 0,
    startedAt: new Date().toISOString(),
    command,
    cwd: projectRoot,
    logPath: paths.watcherLogPath,
    errorLogPath: paths.watcherLogPath
  };
  await writeFile(paths.watcherPidPath, `${JSON.stringify(pidFile, null, 2)}\n`, "utf8");

  return { alreadyRunning: false, pid: child.pid, paths };
}

export async function stopTunnelWatcher(env: HubHttpEnv) {
  const paths = getTunnelPaths(env.MCP_HUB_DATA_DIR);
  const existing = await readPidFile(paths.watcherPidPath).catch(() => undefined);
  if (!existing) {
    return { stopped: false, reason: "No watcher pid file.", paths };
  }

  if (!isProcessRunning(existing.pid)) {
    await unlink(paths.watcherPidPath).catch(() => undefined);
    return { stopped: false, reason: "Watcher pid file was stale.", pid: existing.pid, paths };
  }

  process.kill(existing.pid, "SIGTERM");
  await waitForExit(existing.pid, 3000);
  await unlink(paths.watcherPidPath).catch(() => undefined);
  return { stopped: true, pid: existing.pid, paths };
}

export async function watchTunnel(input: EnsureTunnelInput & { intervalMs?: number }) {
  const intervalMs = input.intervalMs ?? 20_000;

  for (;;) {
    try {
      const status = await ensureNgrokTunnel(input);
      console.log(`${new Date().toISOString()} tunnel ok: ${status.connectorUrl}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`${new Date().toISOString()} tunnel check failed: ${message}`);
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export function getNgrokInstallInfo(): NgrokInstallInfo {
  const links = [
    { label: "ngrok downloads", url: "https://ngrok.com/download" },
    { label: "ngrok setup docs", url: "https://ngrok.com/docs/getting-started/" },
    { label: "ngrok auth token dashboard", url: "https://dashboard.ngrok.com/get-started/your-authtoken" }
  ];

  if (process.platform === "darwin") {
    return {
      platform: process.platform,
      arch: os.arch(),
      supported: true,
      recommended: ["brew install ngrok"],
      links
    };
  }

  if (process.platform === "linux") {
    return {
      platform: process.platform,
      arch: os.arch(),
      supported: true,
      recommended: [
        "curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null",
        'echo "deb https://ngrok-agent.s3.amazonaws.com buster main" | sudo tee /etc/apt/sources.list.d/ngrok.list',
        "sudo apt update && sudo apt install ngrok"
      ],
      links
    };
  }

  if (process.platform === "win32") {
    return {
      platform: process.platform,
      arch: os.arch(),
      supported: true,
      recommended: ["winget install ngrok.ngrok", "or install from Microsoft Store"],
      links: [
        ...links,
        { label: "Microsoft Store ngrok", url: "https://apps.microsoft.com/detail/9PG9JCVL7WHT" }
      ]
    };
  }

  return {
    platform: process.platform,
    arch: os.arch(),
    supported: false,
    recommended: ["Use the official ngrok downloads page."],
    links
  };
}

async function waitForPublicUrl(projectRoot: string, env: HubHttpEnv, timeoutMs: number) {
  const started = Date.now();
  let status = await getNgrokStatus(projectRoot, env);

  while (!status.publicUrl && Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    status = await getNgrokStatus(projectRoot, env);
  }

  return status;
}

async function readNgrokTunnels() {
  const response = await fetch(defaultNgrokApi);
  if (!response.ok) {
    throw new Error(`ngrok api returned ${response.status}`);
  }

  return (await response.json()) as { tunnels?: Array<{ public_url?: string; proto?: string }> };
}

function findHttpsTunnelUrl(data: { tunnels?: Array<{ public_url?: string; proto?: string }> } | undefined) {
  return data?.tunnels?.find((tunnel) => tunnel.public_url?.startsWith("https://"))?.public_url;
}

async function isNgrokInstalled() {
  try {
    await runNgrok(["version"]);
    return true;
  } catch {
    return false;
  }
}

async function runNgrok(args: string[], options: { redact?: string } = {}) {
  return runCommand(process.env.NGROK_BIN ?? "ngrok", args, options);
}

async function commandExists(command: string) {
  try {
    await runCommand(command, ["--version"]);
    return true;
  } catch {
    return false;
  }
}

async function runCommand(command: string, args: string[], options: { redact?: string } = {}) {
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env
  });
  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });

  if (exitCode !== 0) {
    const message = `${stdout}\n${stderr}`.trim().replaceAll(options.redact ?? "\u0000", "[redacted]");
    throw new Error(message || `${command} exited with code ${exitCode}`);
  }

  return { stdout, stderr };
}

async function upsertEnvValue(envPath: string, key: string, value: string) {
  const current = await readFile(envPath, "utf8").catch(() => "");
  const lines = current.split(/\r?\n/);
  let changed = false;
  let replaced = false;
  const nextLines = lines.map((line) => {
    if (line.match(new RegExp(`^${escapeRegExp(key)}=`))) {
      replaced = true;
      const next = `${key}=${JSON.stringify(value)}`;
      if (line !== next) {
        changed = true;
      }
      return next;
    }

    return line;
  });

  if (!replaced) {
    if (nextLines.length > 0 && nextLines[nextLines.length - 1] !== "") {
      nextLines.push("");
    }
    nextLines.push(`${key}=${JSON.stringify(value)}`);
    changed = true;
  }

  if (changed) {
    await writeFile(envPath, `${nextLines.join("\n").replace(/\n*$/, "")}\n`, "utf8");
  }

  return changed;
}

async function readPidFile(pidPath: string): Promise<PidFile> {
  return JSON.parse(await readFile(pidPath, "utf8")) as PidFile;
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

async function readLog(filePath: string, maxBytes: number) {
  const stats = await stat(filePath).catch(() => undefined);
  if (!stats) {
    return "";
  }

  const content = await readFile(filePath, "utf8");
  return content.length > maxBytes ? content.slice(content.length - maxBytes) : content;
}

function withMcpPath(url: string) {
  const trimmed = url.replace(/\/+$/, "");
  return trimmed.endsWith("/mcp") ? trimmed : `${trimmed}/mcp`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
