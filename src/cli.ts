#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getCodexConfigStatus, installCodexConfig, removeCodexConfig } from "./codex/config.js";
import { getServiceStatus, readServiceLog, startHttpService, stopHttpService } from "./service/manager.js";
import {
  configureNgrokAuthtoken,
  ensureNgrokTunnel,
  getNgrokStatus,
  installNgrokIfPossible,
  startTunnelWatcher,
  stopNgrokTunnel,
  stopTunnelWatcher,
  watchTunnel
} from "./tunnel/ngrok.js";

type Command = "setup" | "serve" | "doctor" | "tools" | "run" | "config" | "tunnel" | "worker" | "help";

interface HubEnv {
  MCP_HUB_DATA_DIR: string;
  MCP_HUB_MEMORY_SPACE: string;
  MCP_HUB_WORKSPACE: string;
  MCP_HUB_HTTP_HOST: string;
  MCP_HUB_HTTP_PORT: string;
  MCP_HUB_HTTP_TOKEN?: string;
  MCP_HUB_PUBLIC_URL?: string;
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(projectRoot, ".env");

async function main() {
  const command = parseCommand(process.argv[2]);

  if (command === "help") {
    printHelp();
    return;
  }

  if (command === "setup") {
    await setup();
    return;
  }

  if (command === "serve") {
    await serve(process.argv.slice(3));
    return;
  }

  if (command === "doctor") {
    await doctor();
    return;
  }

  if (command === "tools") {
    await printTools();
    return;
  }

  if (command === "run") {
    await runWrappedCommand(process.argv.slice(3));
    return;
  }

  if (command === "config") {
    await manageCodexConfig(process.argv.slice(3));
    return;
  }

  if (command === "tunnel") {
    await manageTunnel(process.argv.slice(3));
    return;
  }

  if (command === "worker") {
    await manageWorker(process.argv.slice(3));
  }
}

function parseCommand(value: string | undefined): Command {
  if (
    value === "setup" ||
    value === "serve" ||
    value === "doctor" ||
    value === "tools" ||
    value === "run" ||
    value === "config" ||
    value === "tunnel" ||
    value === "worker"
  ) {
    return value;
  }

  return "help";
}

async function setup() {
  const existing = await readEnvFile();
  const env: HubEnv = {
    MCP_HUB_DATA_DIR: existing.MCP_HUB_DATA_DIR ?? join(projectRoot, ".data"),
    MCP_HUB_MEMORY_SPACE: existing.MCP_HUB_MEMORY_SPACE ?? "default",
    MCP_HUB_WORKSPACE: existing.MCP_HUB_WORKSPACE ?? projectRoot,
    MCP_HUB_HTTP_HOST: existing.MCP_HUB_HTTP_HOST ?? "127.0.0.1",
    MCP_HUB_HTTP_PORT: existing.MCP_HUB_HTTP_PORT ?? "3333",
    MCP_HUB_HTTP_TOKEN: existing.MCP_HUB_HTTP_TOKEN
  };

  await mkdir(env.MCP_HUB_DATA_DIR, { recursive: true });
  await writeFile(envPath, serializeEnv(env), "utf8");
  await writeFile(join(projectRoot, "codex-config.generated.toml"), renderCodexConfig(env), "utf8");

  printBox("Codex ChatGPT Hub setup complete", [
    `Project: ${projectRoot}`,
    `Data dir: ${env.MCP_HUB_DATA_DIR}`,
    `Memory space: ${env.MCP_HUB_MEMORY_SPACE}`,
    `Workspace: ${env.MCP_HUB_WORKSPACE}`,
    `Local MCP URL: http://${env.MCP_HUB_HTTP_HOST}:${env.MCP_HUB_HTTP_PORT}/mcp`,
    `Health URL: http://${env.MCP_HUB_HTTP_HOST}:${env.MCP_HUB_HTTP_PORT}/health`,
    "",
    "Next:",
    "1. Run npm run config -- install to inject Codex MCP config.",
    "2. Run npm run serve.",
    "3. Expose the local /mcp endpoint with ngrok or Cloudflare Tunnel for ChatGPT Connector."
  ]);
}

async function manageCodexConfig(args: string[]) {
  const subcommand = args[0] ?? "status";
  const options = parseConfigArgs(args.slice(1));
  const env = await loadHubEnv();
  const configPath = options.configPath;

  if (subcommand === "status") {
    const status = await getCodexConfigStatus(configPath);
    console.log(`Codex config: ${status.configPath}`);
    console.log(`Exists:       ${status.exists ? "yes" : "no"}`);
    console.log(`Installed:    ${status.installed ? "yes" : "no"}`);
    if (status.serverName) {
      console.log(`Server name:  ${status.serverName}`);
    }
    return;
  }

  if (subcommand === "install" || subcommand === "update") {
    const result = await installCodexConfig({
      projectRoot,
      env,
      configPath,
      serverName: options.serverName,
      dryRun: options.dryRun
    });
    console.log(`${options.dryRun ? "Previewed" : result.changed ? "Installed" : "Already up to date"} Codex MCP config.`);
    console.log(`Config: ${result.configPath}`);
    if (options.dryRun) {
      console.log("");
      console.log(result.preview);
    }
    return;
  }

  if (subcommand === "remove") {
    const result = await removeCodexConfig(configPath, options.dryRun);
    console.log(`${options.dryRun ? "Previewed removal from" : result.changed ? "Removed managed block from" : "No managed block in"} Codex config.`);
    console.log(`Config: ${result.configPath}`);
    if (options.dryRun) {
      console.log("");
      console.log(result.preview);
    }
    return;
  }

  throw new Error(`Unknown config command: ${subcommand}. Expected status, install, update, or remove.`);
}

async function manageTunnel(args: string[]) {
  const subcommand = args[0] ?? "status";
  const options = parseTunnelArgs(args.slice(1));
  const env = await loadHubEnv();
  applyEnv(env);

  if (subcommand === "install") {
    const result = await installNgrokIfPossible(options.printOnly);
    console.log(result.message);
    printNgrokInstallInfo(result.info);
    return;
  }

  if (subcommand === "setup") {
    const token = options.authtoken ?? process.env.NGROK_AUTHTOKEN;
    if (!token) {
      throw new Error("Missing ngrok authtoken. Use: npm run tunnel -- setup --authtoken YOUR_TOKEN");
    }
    await installNgrokIfPossible(false);
    await configureNgrokAuthtoken(token);
    const status = await ensureNgrokTunnel({ projectRoot, env, envPath });
    printTunnelSummary(status);
    return;
  }

  if (subcommand === "start" || subcommand === "ensure") {
    const status = await ensureNgrokTunnel({ projectRoot, env, envPath });
    printTunnelSummary(status);
    return;
  }

  if (subcommand === "stop") {
    await stopTunnelWatcher(env).catch(() => undefined);
    const result = await stopNgrokTunnel(env);
    console.log(result.stopped ? `Stopped ngrok pid ${result.pid}.` : `ngrok not stopped: ${result.reason}`);
    return;
  }

  if (subcommand === "status") {
    const status = await getNgrokStatus(projectRoot, env);
    printTunnelSummary(status);
    return;
  }

  if (subcommand === "watch") {
    await watchTunnel({ projectRoot, env, envPath, intervalMs: options.intervalMs });
    return;
  }

  if (subcommand === "start-watcher") {
    const result = await startTunnelWatcher(projectRoot, env);
    console.log(
      result.alreadyRunning
        ? `ngrok watcher already running (pid ${result.pid}).`
        : `ngrok watcher started in background (pid ${result.pid}).`
    );
    console.log(`Watcher log: ${result.paths.watcherLogPath}`);
    return;
  }

  if (subcommand === "stop-watcher") {
    const result = await stopTunnelWatcher(env);
    console.log(result.stopped ? `Stopped ngrok watcher pid ${result.pid}.` : `Watcher not stopped: ${result.reason}`);
    return;
  }

  throw new Error(`Unknown tunnel command: ${subcommand}. Expected install, setup, start, ensure, stop, status, watch, start-watcher, or stop-watcher.`);
}

async function serve(args: string[]) {
  const env = await loadHubEnv();
  const mode = args[0] ?? "start";

  if (mode === "start") {
    const result = await startHttpService(projectRoot, env);
    console.log(
      result.alreadyRunning
        ? result.external
          ? "HTTP MCP already reachable on the configured port (not managed by this CLI pid file)."
          : `HTTP MCP already running (pid ${result.pid}).`
        : `HTTP MCP started in background (pid ${result.pid}).`
    );
    console.log(`Dashboard: http://${env.MCP_HUB_HTTP_HOST}:${env.MCP_HUB_HTTP_PORT}/`);
    console.log(`MCP URL:   http://${env.MCP_HUB_HTTP_HOST}:${env.MCP_HUB_HTTP_PORT}/mcp`);
    console.log(`Logs:      ${result.paths.logPath}`);
    return;
  }

  if (mode === "foreground") {
    await serveForeground(env);
    return;
  }

  if (mode === "stop") {
    const result = await stopHttpService(projectRoot, env);
    console.log(result.stopped ? `Stopped HTTP MCP pid ${result.pid}.` : `HTTP MCP not stopped: ${result.reason}`);
    return;
  }

  if (mode === "restart") {
    await stopHttpService(projectRoot, env);
    const result = await startHttpService(projectRoot, env);
    console.log(`HTTP MCP restarted in background (pid ${result.pid}).`);
    console.log(`Dashboard: http://${env.MCP_HUB_HTTP_HOST}:${env.MCP_HUB_HTTP_PORT}/`);
    return;
  }

  if (mode === "status") {
    const status = await getServiceStatus(projectRoot, env);
    console.log(
      `HTTP MCP: ${status.running ? "running" : "stopped"}${status.process ? ` (pid ${status.process.pid})` : ""}${status.running && !status.managed ? " (external/foreground)" : ""}`
    );
    console.log(`Health:   ${status.health?.ok ? "ok" : "down"}${status.health?.detail ? ` - ${status.health.detail}` : ""}`);
    console.log(`URL:      ${status.configured.localUrl}`);
    console.log(`Data:     ${status.paths.dataDir}`);
    console.log(`Space:    ${env.MCP_HUB_MEMORY_SPACE}`);
    console.log(`Logs:     ${status.paths.logPath}`);
    if (status.stalePid) {
      console.log(`Warning: stale pid file at ${status.paths.pidPath}`);
    }
    return;
  }

  if (mode === "logs") {
    const kind = args[1] === "stderr" ? "stderr" : "stdout";
    console.log(await readServiceLog(projectRoot, env, kind));
    return;
  }

  throw new Error(`Unknown serve mode: ${mode}. Expected start, foreground, stop, restart, status, logs.`);
}

async function serveForeground(env: HubEnv) {
  const child = spawn(process.execPath, [join(projectRoot, "dist/http.js")], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ...env
    },
    stdio: "inherit"
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

async function manageWorker(args: string[]) {
  const env = await loadHubEnv();
  applyEnv(env);
  const mode = args[0] ?? "once";
  const options = mode === "logs" ? {} : parseWorkerArgs(args.slice(1));

  if (mode === "once") {
    const { runWorkerOnce } = await import("./worker/dispatcher.js");
    const result = await runWorkerOnce({
      projectRoot,
      tag: options.tag,
      limit: options.limit,
      dryRun: options.dryRun,
      model: options.model,
      sandbox: options.sandbox,
      approval: options.approval
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.status === "executed" && result.exitCode && result.exitCode !== 0) {
      process.exit(result.exitCode);
    }
    return;
  }

  if (mode === "foreground") {
    const { runWorkerOnce } = await import("./worker/dispatcher.js");
    const intervalMs = options.intervalMs ?? 15_000;
    console.log(`Codex worker foreground started. Space=${env.MCP_HUB_MEMORY_SPACE} intervalMs=${intervalMs}`);
    for (;;) {
      const result = await runWorkerOnce({
        projectRoot,
        tag: options.tag,
        limit: options.limit,
        dryRun: options.dryRun,
        model: options.model,
        sandbox: options.sandbox,
        approval: options.approval
      });
      console.log(`${new Date().toISOString()} ${JSON.stringify(result)}`);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
    }
  }

  const { getWorkerStatus, readWorkerLog, startWorkerService, stopWorkerService } = await import("./worker/manager.js");

  if (mode === "start") {
    const result = await startWorkerService(projectRoot, env, {
      intervalMs: options.intervalMs,
      tag: options.tag,
      dryRun: options.dryRun,
      model: options.model,
      sandbox: options.sandbox,
      approval: options.approval
    });
    console.log(
      result.alreadyRunning
        ? `Codex worker already running (pid ${result.pid}).`
        : `Codex worker started in background (pid ${result.pid}).`
    );
    console.log(`Space: ${env.MCP_HUB_MEMORY_SPACE}`);
    console.log(`Logs:  ${result.paths.logPath}`);
    return;
  }

  if (mode === "stop") {
    const result = await stopWorkerService(env);
    console.log(result.stopped ? `Stopped Codex worker pid ${result.pid}.` : `Codex worker not stopped: ${result.reason}`);
    return;
  }

  if (mode === "status") {
    const status = await getWorkerStatus(env);
    console.log(`Codex worker: ${status.running ? "running" : "stopped"}${status.process ? ` (pid ${status.process.pid})` : ""}`);
    console.log(`Space:        ${status.memorySpace}`);
    console.log(`Logs:         ${status.paths.logPath}`);
    if (status.stalePid) {
      console.log(`Warning: stale pid file at ${status.paths.pidPath}`);
    }
    return;
  }

  if (mode === "logs") {
    const kind = args[1] === "stderr" ? "stderr" : "stdout";
    console.log(await readWorkerLog(env, kind));
    return;
  }

  throw new Error(`Unknown worker mode: ${mode}. Expected once, foreground, start, stop, status, logs.`);
}

async function doctor() {
  const env = await loadHubEnv();
  applyEnv(env);
  const { tools } = await import("./tools/index.js");
  const localMcpUrl = `http://${env.MCP_HUB_HTTP_HOST}:${env.MCP_HUB_HTTP_PORT}/mcp`;
  const checks: Array<[string, boolean, string]> = [];

  checks.push(["dist/index.js exists", existsSync(join(projectRoot, "dist/index.js")), "Run npm run build."]);
  checks.push(["dist/http.js exists", existsSync(join(projectRoot, "dist/http.js")), "Run npm run build."]);
  checks.push([".env exists", existsSync(envPath), "Run npm run setup."]);
  checks.push(["data dir exists", existsSync(env.MCP_HUB_DATA_DIR), "Run npm run setup."]);

  const service = await getServiceStatus(projectRoot, env);
  const healthDetail = service.health?.detail ?? "";
  checks.push(["HTTP service process", service.running, "Start it with npm run serve."]);
  checks.push(["HTTP server health", service.health?.ok === true, `Start it with npm run serve. URL: ${service.configured.healthUrl}`]);

  for (const [label, ok, hint] of checks) {
    console.log(`${ok ? "OK " : "ERR"} ${label}${ok ? "" : ` - ${hint}`}`);
  }

  console.log("");
  console.log(`Local MCP URL: ${localMcpUrl}`);
  console.log(`Health check: ${service.configured.healthUrl} (${healthDetail})`);
  console.log(`Dashboard: http://${env.MCP_HUB_HTTP_HOST}:${env.MCP_HUB_HTTP_PORT}/`);
  console.log(`Memory space: ${env.MCP_HUB_MEMORY_SPACE}`);
  console.log(`Service logs: ${service.paths.logPath}`);
  console.log(`Tools exposed: ${tools.length}`);
  console.log(`Codex config snippet: ${join(projectRoot, "codex-config.generated.toml")}`);
}

async function printTools() {
  const env = await loadHubEnv();
  applyEnv(env);
  const { tools } = await import("./tools/index.js");
  const grouped = tools.reduce<Record<string, string[]>>((acc, tool) => {
    const prefix = tool.name.startsWith("paper_")
      ? "paper"
      : tool.name.startsWith("hub_")
        ? "hub"
        : tool.name.startsWith("session_")
          ? "session"
          : tool.name.startsWith("run_")
            ? "run"
            : tool.name.startsWith("profile_")
              ? "profile"
              : "other";
    acc[prefix] = acc[prefix] ?? [];
    acc[prefix].push(tool.name);
    return acc;
  }, {});

  for (const group of ["hub", "paper", "session", "run", "profile", "other"]) {
    console.log(`${group}:`);
    for (const name of grouped[group] ?? []) {
      console.log(`  - ${name}`);
    }
  }
}

async function runWrappedCommand(args: string[]) {
  const parsed = parseRunArgs(args);
  const env = await loadHubEnv();
  applyEnv(env);
  const { addCommandEvent, appendSessionEvent, createSession, upsertSessionHandoff } = await import("./session/store.js");
  const { rebuildRunIndex, writeRunManifest } = await import("./run/store.js");
  const cwd = resolve(parsed.cwd ?? projectRoot);
  const session =
    parsed.sessionId ??
    (
      await createSession({
        title: parsed.title ?? `Run: ${parsed.command.join(" ")}`,
        objective: "Automatically captured command run.",
        taskId: parsed.taskId,
        projectId: parsed.projectId,
        workspaceRoot: cwd,
        createdBy: "codex",
        tags: ["run-wrapper"]
      })
    ).id;
  const runId = createRunId();
  const runDir = join(resolveMemorySpaceDataDir(env.MCP_HUB_DATA_DIR, env.MCP_HUB_MEMORY_SPACE), "runs", runId);
  const stdoutPath = join(runDir, "stdout.log");
  const stderrPath = join(runDir, "stderr.log");
  const diffPath = join(runDir, "diff.patch");
  const metaPath = join(runDir, "meta.json");
  const manifestPath = join(runDir, "manifest.json");
  const artifactsDir = join(runDir, "artifacts");

  await mkdir(artifactsDir, { recursive: true });
  await appendSessionEvent({
    sessionId: session,
    kind: "command",
    actor: "codex",
    text: `Starting wrapped command: ${parsed.command.join(" ")}`,
    command: parsed.command.join(" "),
    source: runDir,
    metadata: { runId, cwd, stdoutPath, stderrPath, diffPath, artifactsDir }
  });

  const stdinText = parsed.stdinFile ? await readFile(resolve(parsed.stdinFile), "utf8") : undefined;
  const startedAt = Date.now();
  const result = await executeAndCapture(
    parsed.command,
    cwd,
    stdoutPath,
    stderrPath,
    {
      MCP_HUB_RUN_ID: runId,
      MCP_HUB_RUN_DIR: runDir,
      MCP_HUB_RUN_ARTIFACTS_DIR: artifactsDir
    },
    stdinText
  );
  const durationMs = Date.now() - startedAt;
  const diff = await readGitDiff(cwd);
  await writeFile(diffPath, diff, "utf8");
  const manifest = await writeRunManifest(runId);

  const stdoutTail = tailText(result.stdout, 8000);
  const stderrTail = tailText(result.stderr, 8000);
  const summary =
    result.exitCode === 0
      ? `Command passed: ${parsed.command.join(" ")}`
      : `Command failed with exit code ${result.exitCode}: ${parsed.command.join(" ")}`;

  await writeFile(
    metaPath,
    `${JSON.stringify(
      {
        runId,
        sessionId: session,
        command: parsed.command,
        cwd,
        exitCode: result.exitCode,
        durationMs,
        startedAt: new Date(startedAt).toISOString(),
        endedAt: new Date().toISOString(),
        stdoutPath,
        stderrPath,
        diffPath,
        artifactsDir,
        manifestPath,
        artifacts: {
          total: manifest.artifacts.length,
          byKind: manifest.artifacts.reduce<Record<string, number>>((acc, artifact) => {
            acc[artifact.kind] = (acc[artifact.kind] ?? 0) + 1;
            return acc;
          }, {})
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await rebuildRunIndex();

  await addCommandEvent({
    sessionId: session,
    command: parsed.command.join(" "),
    exitCode: result.exitCode,
    durationMs,
    status: result.exitCode === 0 ? "passed" : "failed",
    summary,
    stdoutTail,
    stderrTail,
    metadata: { runId, cwd, stdoutPath, stderrPath, diffPath, artifactsDir, manifestPath }
  });

  await upsertSessionHandoff({
    sessionId: session,
    summary,
    currentState: `Latest wrapped run ${runId} completed with exit code ${result.exitCode}.`,
    nextSteps: result.exitCode === 0 ? ["Review stdout/stderr tails or diff if needed."] : ["Inspect stderr tail and diff."],
    blockers: result.exitCode === 0 ? [] : [`Command failed: ${parsed.command.join(" ")}`],
    importantFiles: [stdoutPath, stderrPath, diffPath, metaPath, manifestPath, artifactsDir],
    openQuestions: []
  });

  console.error("");
  console.error(`mcp-hub run captured: ${runDir}`);
  console.error(`sessionId: ${session}`);
  console.error(`exitCode: ${result.exitCode}`);
  process.exit(result.exitCode);
}

function parseRunArgs(args: string[]) {
  const separator = args.indexOf("--");
  if (separator === -1) {
    throw new Error("Missing -- before command. Example: npm run wrap -- --session-id sess_x -- npm run build");
  }

  const optionArgs = args.slice(0, separator);
  const command = args.slice(separator + 1);
  if (command.length === 0) {
    throw new Error("Missing command after --.");
  }

  const parsed: {
    sessionId?: string;
    title?: string;
    taskId?: string;
    projectId?: string;
    cwd?: string;
    stdinFile?: string;
    command: string[];
  } = { command };

  for (let index = 0; index < optionArgs.length; index += 1) {
    const option = optionArgs[index];
    const value = optionArgs[index + 1];
    if (!option?.startsWith("--") || !value) {
      throw new Error(`Invalid run option near: ${option ?? ""}`);
    }

    index += 1;
    if (option === "--session-id") {
      parsed.sessionId = value;
    } else if (option === "--title") {
      parsed.title = value;
    } else if (option === "--task-id") {
      parsed.taskId = value;
    } else if (option === "--project-id") {
      parsed.projectId = value;
    } else if (option === "--cwd") {
      parsed.cwd = value;
    } else if (option === "--stdin-file") {
      parsed.stdinFile = value;
    } else {
      throw new Error(`Unknown run option: ${option}`);
    }
  }

  return parsed;
}

function parseConfigArgs(args: string[]) {
  const parsed: {
    configPath?: string;
    serverName?: string;
    dryRun?: boolean;
  } = {};

  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];

    if (option === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }

    const value = args[index + 1];
    if (!option?.startsWith("--") || !value) {
      throw new Error(`Invalid config option near: ${option ?? ""}`);
    }

    index += 1;
    if (option === "--config-path") {
      parsed.configPath = resolve(value);
    } else if (option === "--server-name") {
      parsed.serverName = value;
    } else {
      throw new Error(`Unknown config option: ${option}`);
    }
  }

  return parsed;
}

function parseWorkerArgs(args: string[]) {
  const parsed: {
    tag?: string;
    intervalMs?: number;
    limit?: number;
    dryRun?: boolean;
    model?: string;
    sandbox?: "read-only" | "workspace-write" | "danger-full-access";
    approval?: "untrusted" | "on-request" | "never";
  } = {};

  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];

    if (option === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }

    const value = args[index + 1];
    if (!option?.startsWith("--") || !value) {
      throw new Error(`Invalid worker option near: ${option ?? ""}`);
    }

    index += 1;
    if (option === "--tag") {
      parsed.tag = value;
    } else if (option === "--interval-ms") {
      parsed.intervalMs = parsePositiveInteger(value, option);
    } else if (option === "--limit") {
      parsed.limit = parsePositiveInteger(value, option);
    } else if (option === "--model") {
      parsed.model = value;
    } else if (option === "--sandbox") {
      if (value !== "read-only" && value !== "workspace-write" && value !== "danger-full-access") {
        throw new Error(`Invalid ${option}: ${value}`);
      }
      parsed.sandbox = value;
    } else if (option === "--approval") {
      if (value !== "untrusted" && value !== "on-request" && value !== "never") {
        throw new Error(`Invalid ${option}: ${value}`);
      }
      parsed.approval = value;
    } else {
      throw new Error(`Unknown worker option: ${option}`);
    }
  }

  return parsed;
}

function parsePositiveInteger(value: string, label: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return parsed;
}

function parseTunnelArgs(args: string[]) {
  const parsed: {
    authtoken?: string;
    printOnly?: boolean;
    intervalMs?: number;
  } = {};

  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];

    if (option === "--print-only") {
      parsed.printOnly = true;
      continue;
    }

    const value = args[index + 1];
    if (!option?.startsWith("--") || !value) {
      throw new Error(`Invalid tunnel option near: ${option ?? ""}`);
    }

    index += 1;
    if (option === "--authtoken") {
      parsed.authtoken = value;
    } else if (option === "--interval-ms") {
      parsed.intervalMs = Number.parseInt(value, 10);
    } else {
      throw new Error(`Unknown tunnel option: ${option}`);
    }
  }

  return parsed;
}

function printTunnelSummary(status: {
  installed: boolean;
  running: boolean;
  pid?: number;
  publicUrl?: string;
  connectorUrl?: string;
  localMcpUrl: string;
  health: { mcp: boolean; ngrokApi: boolean };
  paths: { logPath: string; errorLogPath: string };
  envUpdated?: boolean;
}) {
  console.log(`ngrok installed: ${status.installed ? "yes" : "no"}`);
  console.log(`ngrok running:   ${status.running ? "yes" : "no"}${status.pid ? ` (pid ${status.pid})` : ""}`);
  console.log(`MCP health:      ${status.health.mcp ? "ok" : "down"}`);
  console.log(`ngrok API:       ${status.health.ngrokApi ? "ok" : "down"}`);
  console.log(`Local MCP URL:   ${status.localMcpUrl}`);
  if (status.publicUrl) {
    console.log(`Public URL:      ${status.publicUrl}`);
  }
  if (status.connectorUrl) {
    console.log(`Connector URL:   ${status.connectorUrl}`);
  }
  if (status.envUpdated !== undefined) {
    console.log(`Updated .env:    ${status.envUpdated ? "yes" : "no"}`);
  }
  console.log(`ngrok logs:      ${status.paths.logPath}`);
}

function printNgrokInstallInfo(info: {
  platform: string;
  arch: string;
  supported: boolean;
  recommended: string[];
  links: Array<{ label: string; url: string }>;
}) {
  console.log(`Platform: ${info.platform}/${info.arch}`);
  console.log(`Supported: ${info.supported ? "yes" : "manual"}`);
  console.log("Recommended:");
  for (const command of info.recommended) {
    console.log(`  ${command}`);
  }
  console.log("Links:");
  for (const link of info.links) {
    console.log(`  ${link.label}: ${link.url}`);
  }
}

async function executeAndCapture(
  command: string[],
  cwd: string,
  stdoutPath: string,
  stderrPath: string,
  extraEnv: Record<string, string>,
  stdinText?: string
) {
  const [executable, ...args] = command;
  if (!executable) {
    throw new Error("Missing executable.");
  }

  const child = spawn(executable, args, {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdio: [stdinText === undefined ? "inherit" : "pipe", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";

  if (stdinText !== undefined) {
    child.stdin?.end(stdinText);
  }

  child.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    stdout += text;
    process.stdout.write(text);
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    stderr += text;
    process.stderr.write(text);
  });

  const exitCode = await new Promise<number>((resolvePromise, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolvePromise(code ?? 1));
  });

  await Promise.all([writeFile(stdoutPath, stdout, "utf8"), writeFile(stderrPath, stderr, "utf8")]);
  return { exitCode, stdout, stderr };
}

async function readGitDiff(cwd: string) {
  const child = spawn("git", ["diff", "--", ".", ":(exclude).data"], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });

  const exitCode = await new Promise<number>((resolvePromise) => {
    child.on("error", () => resolvePromise(1));
    child.on("close", (code) => resolvePromise(code ?? 1));
  });

  return exitCode === 0 ? stdout : `git diff unavailable\n${stderr}`;
}

function tailText(text: string, maxChars: number) {
  if (text.length <= maxChars) {
    return text;
  }

  return text.slice(text.length - maxChars);
}

function createRunId() {
  return `run_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
}

function resolveMemorySpaceDataDir(rootDataDir: string, space: string) {
  const normalized = sanitizeMemorySpace(space);
  const absoluteRoot = resolve(rootDataDir);
  return normalized === "default" ? absoluteRoot : join(absoluteRoot, "spaces", normalized);
}

function sanitizeMemorySpace(value: string) {
  const trimmed = value.trim();

  if (!trimmed || trimmed === "default") {
    return "default";
  }

  const normalized = trimmed
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 80);
  return normalized || `space-${Buffer.from(trimmed).toString("hex").slice(0, 16)}`;
}

async function loadHubEnv(): Promise<HubEnv> {
  const envFile = await readEnvFile();
  return {
    MCP_HUB_DATA_DIR: process.env.MCP_HUB_DATA_DIR ?? envFile.MCP_HUB_DATA_DIR ?? join(projectRoot, ".data"),
    MCP_HUB_MEMORY_SPACE: process.env.MCP_HUB_MEMORY_SPACE ?? envFile.MCP_HUB_MEMORY_SPACE ?? "default",
    MCP_HUB_WORKSPACE: process.env.MCP_HUB_WORKSPACE ?? envFile.MCP_HUB_WORKSPACE ?? projectRoot,
    MCP_HUB_HTTP_HOST: process.env.MCP_HUB_HTTP_HOST ?? envFile.MCP_HUB_HTTP_HOST ?? "127.0.0.1",
    MCP_HUB_HTTP_PORT: process.env.MCP_HUB_HTTP_PORT ?? envFile.MCP_HUB_HTTP_PORT ?? "3333",
    MCP_HUB_HTTP_TOKEN: process.env.MCP_HUB_HTTP_TOKEN ?? envFile.MCP_HUB_HTTP_TOKEN,
    MCP_HUB_PUBLIC_URL: process.env.MCP_HUB_PUBLIC_URL ?? envFile.MCP_HUB_PUBLIC_URL
  };
}

function applyEnv(env: HubEnv) {
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
}

async function readEnvFile() {
  if (!existsSync(envPath)) {
    return {} as Record<string, string>;
  }

  const raw = await readFile(envPath, "utf8");
  const env: Record<string, string> = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const index = trimmed.indexOf("=");
    if (index === -1) {
      continue;
    }

    const key = trimmed.slice(0, index);
    const value = trimmed.slice(index + 1).replace(/^"|"$/g, "");
    env[key] = value;
  }

  return env;
}

function serializeEnv(env: HubEnv) {
  const entries = Object.entries(env).filter(([, value]) => value !== undefined);
  return `${entries.map(([key, value]) => `${key}="${value}"`).join("\n")}\n`;
}

function renderCodexConfig(env: HubEnv) {
  return `[mcp_servers.codex-chatgpt-hub]
command = "node"
args = ["${join(projectRoot, "dist/index.js")}"]
startup_timeout_sec = 10

[mcp_servers.codex-chatgpt-hub.env]
MCP_HUB_DATA_DIR = "${env.MCP_HUB_DATA_DIR}"
MCP_HUB_MEMORY_SPACE = "${env.MCP_HUB_MEMORY_SPACE}"
MCP_HUB_WORKSPACE = "${env.MCP_HUB_WORKSPACE}"
`;
}

function printHelp() {
  console.log(`codex-chatgpt-hub

Commands:
  setup   Generate .env, data dir, and Codex MCP config snippet
  serve   Manage the HTTP MCP server using .env
  config  Install, update, remove, or inspect the Codex MCP config block
  tunnel  Install/check/start ngrok tunnel and keep MCP public URL fresh
  doctor  Check build files, .env, data dir, HTTP health, and exposed tool count
  tools   Print exposed MCP tool names grouped by hub/paper
  run     Run a command and capture stdout/stderr/diff into a session mirror
  worker  Poll codex-auto hub tasks and execute them with codex exec

Examples:
  node dist/cli.js config status
  node dist/cli.js config install
  node dist/cli.js config remove
  node dist/cli.js tunnel install
  node dist/cli.js tunnel setup --authtoken NGROK_TOKEN
  node dist/cli.js tunnel start-watcher
  node dist/cli.js serve
  node dist/cli.js serve restart
  node dist/cli.js serve status
  node dist/cli.js serve logs stderr
  node dist/cli.js worker once --dry-run
  node dist/cli.js worker start
  node dist/cli.js worker status
  node dist/cli.js run -- -- npm run build
  node dist/cli.js run -- --session-id sess_x -- npm run typecheck
`);
}

function printBox(title: string, lines: string[]) {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
  for (const line of lines) {
    console.log(line);
  }
  console.log("");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
