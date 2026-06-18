const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");

const envFileName = ".env";
const defaultHost = "127.0.0.1";
const defaultPort = "3333";

function findProjectRoot(startHints = []) {
  const starts = [
    process.env.CODEX_CHATGPT_HUB_ROOT,
    ...startHints,
    process.cwd(),
    __dirname
  ].filter(Boolean);

  for (const start of starts) {
    let current = path.resolve(start);

    for (let depth = 0; depth < 10; depth += 1) {
      const packagePath = path.join(current, "package.json");
      if (fsSync.existsSync(packagePath)) {
        try {
          const pkg = JSON.parse(fsSync.readFileSync(packagePath, "utf8"));
          if (pkg.name === "codex-chatgpt-hub" && fsSync.existsSync(path.join(current, "src"))) {
            return current;
          }
        } catch {
          // Keep walking.
        }
      }

      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }

  return path.resolve(__dirname, "..", "..", "..");
}

function createHubCore(projectRoot = findProjectRoot()) {
  const envPath = path.join(projectRoot, envFileName);

  async function readManagerState() {
    const env = await readEnvFile(envPath);
    const config = normalizeConfig(projectRoot, env);
    const spaces = await listMemorySpaces(config.dataDir, config.memorySpace);
    const service = await getServiceStatus(config).catch((error) => ({ ok: false, error: error.message }));
    const dashboard = service.ok ? await getDashboard(config).catch((error) => ({ ok: false, error: error.message })) : undefined;
    const codexConfig = await getCommandText(projectRoot, ["run", "config", "--", "status"]).catch((error) => error.message);
    const tunnelStatus = await getCommandText(projectRoot, ["run", "tunnel", "--", "status"]).catch((error) => error.message);
    const workerStatus = await getCommandText(projectRoot, ["run", "worker", "--", "status"]).catch((error) => error.message);
    const workerLogs = await getCommandText(projectRoot, ["run", "worker", "--", "logs"]).catch(() => "");
    const logs = await getCommandText(projectRoot, ["run", "serve", "--", "logs"]).catch(() => "");

    return {
      projectRoot,
      envPath,
      config,
      spaces,
      service,
      dashboard,
      codexConfig,
      tunnelStatus,
      workerStatus,
      workerLogs,
      logs
    };
  }

  async function setMemorySpace(space) {
    const normalized = sanitizeMemorySpace(String(space ?? ""));
    const env = await readEnvFile(envPath);
    env.MCP_HUB_MEMORY_SPACE = normalized;
    const config = normalizeConfig(projectRoot, env);
    await fs.mkdir(config.spaceDataDir, { recursive: true });
    await writeEnvFile(envPath, env);
    return readManagerState();
  }

  async function runAction(action) {
    const allowed = {
      setup: ["run", "setup"],
      "config-install": ["run", "config", "--", "install"],
      "serve-start": ["run", "serve"],
      "serve-restart": ["run", "serve", "--", "restart"],
      "serve-stop": ["run", "serve", "--", "stop"],
      "tunnel-start": ["run", "tunnel", "--", "start"],
      "tunnel-status": ["run", "tunnel", "--", "status"],
      "worker-stop": ["run", "worker", "--", "stop"],
      "worker-status": ["run", "worker", "--", "status"],
      "worker-logs": ["run", "worker", "--", "logs"],
      doctor: ["run", "doctor"],
      tools: ["run", "tools"]
    };
    const args = allowed[action];

    if (!args) {
      throw new Error(`Unsupported action: ${action}`);
    }

    const output = await getCommandText(projectRoot, args, 120_000);
    return {
      output,
      state: await readManagerState()
    };
  }

  async function runWorkerTerminal(mode) {
    const normalized = String(mode ?? "");
    if (normalized !== "once" && normalized !== "foreground") {
      throw new Error(`Unsupported worker terminal mode: ${mode}`);
    }

    const env = await readEnvFile(envPath);
    const config = normalizeConfig(projectRoot, env);
    await openVisibleWorkerTerminal(projectRoot, config, normalized);
    return {
      output: normalized === "once"
        ? "已打开可见终端执行 Codex worker 单次任务。终端会保留，方便查看执行结果。"
        : "已打开可见终端启动 Codex worker 常驻监听。可以在终端里查看过程，或用 Ctrl+C 停止。",
      state: await readManagerState()
    };
  }

  return {
    projectRoot,
    envPath,
    readManagerState,
    setMemorySpace,
    runAction,
    runWorkerTerminal
  };
}

function normalizeConfig(projectRoot, env) {
  const dataDir = path.resolve(projectRoot, env.MCP_HUB_DATA_DIR ?? ".data");
  const memorySpace = sanitizeMemorySpace(env.MCP_HUB_MEMORY_SPACE ?? "default");
  const host = env.MCP_HUB_HTTP_HOST ?? defaultHost;
  const port = env.MCP_HUB_HTTP_PORT ?? defaultPort;
  const workspace = path.resolve(projectRoot, env.MCP_HUB_WORKSPACE ?? projectRoot);
  const publicUrl = env.MCP_HUB_PUBLIC_URL;
  const spaceDataDir = memorySpace === "default" ? dataDir : path.join(dataDir, "spaces", memorySpace);

  return {
    dataDir,
    memorySpace,
    spaceDataDir,
    workspace,
    host,
    port,
    localMcpUrl: `http://${host}:${port}/mcp`,
    healthUrl: `http://${host}:${port}/health`,
    dashboardUrl: `http://${host}:${port}/`,
    publicUrl,
    connectorUrl: publicUrl ? withMcpPath(publicUrl) : undefined,
    auth: env.MCP_HUB_HTTP_TOKEN ? "bearer" : "none"
  };
}

async function listMemorySpaces(dataDir, currentSpace = "default") {
  const spaces = new Set(["default", sanitizeMemorySpace(String(currentSpace ?? ""))]);
  const spacesRoot = path.join(dataDir, "spaces");
  const entries = await fs.readdir(spacesRoot, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    if (entry.isDirectory()) {
      spaces.add(entry.name);
    }
  }

  return Array.from(spaces).sort((left, right) => {
    if (left === "default") return -1;
    if (right === "default") return 1;
    return left.localeCompare(right);
  });
}

async function getServiceStatus(config) {
  const response = await fetch(config.healthUrl);
  const body = await response.json().catch(() => ({}));
  return {
    ok: response.ok && body.ok === true,
    status: response.status,
    body
  };
}

async function getDashboard(config) {
  const response = await fetch(`http://${config.host}:${config.port}/api/dashboard`);
  const body = await response.json();
  return {
    ok: response.ok,
    body
  };
}

function getCommandText(projectRoot, args, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const command = npmCommand(args);
    const childEnv = { ...process.env };
    delete childEnv.ELECTRON_RUN_AS_NODE;

    const child = execFile(command.file, command.args, {
      cwd: projectRoot,
      timeout: timeoutMs,
      windowsHide: true,
      env: childEnv
    }, (error, stdout, stderr) => {
      const text = [stdout, stderr].filter(Boolean).join("\n").trim();
      if (error) {
        reject(new Error(text || error.message));
        return;
      }
      resolve(text);
    });

    child.on("error", reject);
  });
}

async function openVisibleWorkerTerminal(projectRoot, config, mode) {
  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;

  if (process.platform === "win32") {
    const command = mode === "once" ? "npm run worker -- once" : "npm run worker -- foreground";
    const title = mode === "once" ? "Codex Hub Worker - Once" : "Codex Hub Worker - Foreground";
    const launcherPath = await writeWindowsWorkerLauncher(projectRoot, config, mode, title, command);
    const psCommand = [
      `$args = @(${quotePowerShell("/k")}, ${quotePowerShell(`"${launcherPath}"`)})`,
      `Start-Process -FilePath ${quotePowerShell("cmd.exe")} -ArgumentList $args -WorkingDirectory ${quotePowerShell(projectRoot)} -WindowStyle Normal`
    ].join("; ");
    const child = spawn("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      psCommand
    ], {
      cwd: projectRoot,
      windowsHide: true,
      stdio: "ignore",
      env: childEnv
    });

    await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => {
        if (code && code !== 0) {
          reject(new Error(`Failed to open worker terminal with exit code ${code}. Launcher: ${launcherPath}`));
          return;
        }
        resolve();
      });
    });
    return;
  }

  const command = mode === "once" ? "npm run worker -- once" : "npm run worker -- foreground";
  const child = spawn("sh", ["-lc", `${quoteShell(command)}; printf '\\nCodex worker ended. Press Enter to close...'; read _`], {
    cwd: projectRoot,
    detached: true,
    stdio: "ignore",
    env: childEnv
  });
  child.unref();
}

async function writeWindowsWorkerLauncher(projectRoot, config, mode, title, command) {
  const launcherDir = path.join(config.spaceDataDir, "worker", "launchers");
  await fs.mkdir(launcherDir, { recursive: true });
  const launcherPath = path.join(launcherDir, `codex-worker-${mode}.cmd`);
  const doneText = mode === "once" ? "Codex worker finished." : "Codex worker stopped.";
  const lines = [
    "@echo off",
    `title ${title}`,
    `cd /d ${quoteBatchArg(projectRoot)}`,
    "echo Codex ChatGPT Hub worker",
    `echo Memory space: ${config.memorySpace}`,
    `echo Workspace: ${config.workspace}`,
    `echo Command: ${command}`,
    "echo.",
    `call ${command}`,
    "set exitCode=%ERRORLEVEL%",
    "echo.",
    `echo ${doneText}`,
    "echo Exit code: %exitCode%",
    "echo This window stays open for inspection.",
    "echo.",
    "exit /b %exitCode%"
  ];
  await fs.writeFile(launcherPath, `${lines.join("\r\n")}\r\n`, "utf8");
  return launcherPath;
}

function quotePowerShell(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function quoteBatchArg(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function quoteShell(value) {
  return String(value).replace(/'/g, "'\\''");
}

function npmCommand(args) {
  if (process.platform !== "win32") {
    return { file: "npm", args };
  }

  const comSpec = process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe";
  return {
    file: comSpec,
    args: ["/d", "/s", "/c", ["npm", ...args].map(quoteCmdArg).join(" ")]
  };
}

function quoteCmdArg(value) {
  const text = String(value);
  if (!/[()\s^&|<>"]/.test(text)) {
    return text;
  }

  return `"${text.replace(/(["])/g, "\\$1")}"`;
}

async function readEnvFile(envPath) {
  const raw = await fs.readFile(envPath, "utf8").catch(() => "");
  const env = {};

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
    const value = trimmed.slice(index + 1);
    env[key] = parseEnvValue(value);
  }

  return env;
}

async function writeEnvFile(envPath, env) {
  const currentRaw = await fs.readFile(envPath, "utf8").catch(() => "");
  const lines = currentRaw ? currentRaw.split(/\r?\n/) : [];
  const keys = new Set(Object.keys(env));
  const written = new Set();
  const nextLines = lines.map((line) => {
    const trimmed = line.trim();
    const index = trimmed.indexOf("=");
    if (!trimmed || trimmed.startsWith("#") || index === -1) {
      return line;
    }

    const key = trimmed.slice(0, index);
    if (!keys.has(key)) {
      return line;
    }

    written.add(key);
    return `${key}=${JSON.stringify(env[key])}`;
  });

  for (const key of keys) {
    if (!written.has(key)) {
      nextLines.push(`${key}=${JSON.stringify(env[key])}`);
    }
  }

  await fs.writeFile(envPath, `${nextLines.join("\n").replace(/\n*$/, "")}\n`, "utf8");
}

function sanitizeMemorySpace(value) {
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

function parseEnvValue(value) {
  const trimmed = value.trim();

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }

  return trimmed;
}

function withMcpPath(url) {
  const trimmed = url.replace(/\/+$/, "");
  return trimmed.endsWith("/mcp") ? trimmed : `${trimmed}/mcp`;
}

module.exports = {
  createHubCore,
  findProjectRoot,
  normalizeConfig,
  readEnvFile,
  sanitizeMemorySpace,
  writeEnvFile
};
