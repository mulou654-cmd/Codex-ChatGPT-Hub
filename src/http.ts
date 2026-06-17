#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { getHubOverview } from "./hub/store.js";
import { getPaperOverview } from "./paper/store.js";
import { getProfileOverview } from "./profile/store.js";
import { getRunOverview, listRuns, rebuildRunIndex } from "./run/store.js";
import { createMcpServer } from "./server.js";
import { getServiceStatus, readServiceLog } from "./service/manager.js";
import { getSessionOverview } from "./session/store.js";
import { tools } from "./tools/index.js";

const host = process.env.MCP_HUB_HTTP_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.MCP_HUB_HTTP_PORT ?? "3333", 10);
const token = process.env.MCP_HUB_HTTP_TOKEN;
const publicUrl = process.env.MCP_HUB_PUBLIC_URL;
const dataDir = process.env.MCP_HUB_DATA_DIR ?? ".data";
const workspace = process.env.MCP_HUB_WORKSPACE ?? process.cwd();
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const sessions = new Map<string, StreamableHTTPServerTransport>();

const httpServer = createServer(async (req, res) => {
  try {
    if (req.url === "/" || req.url === "/index.html") {
      writeHtml(res, 200, renderHomePage());
      return;
    }

    if (req.url === "/api/dashboard") {
      await rebuildRunIndex().catch(() => undefined);
      writeJson(res, 200, await dashboardPayload());
      return;
    }

    if (req.url === "/api/service/logs") {
      writeText(res, 200, await readServiceLog(projectRoot, serviceEnv(), "stdout"));
      return;
    }

    if (req.url === "/api/service/logs/stderr") {
      writeText(res, 200, await readServiceLog(projectRoot, serviceEnv(), "stderr"));
      return;
    }

    if (req.url === "/api/runs") {
      writeJson(res, 200, await listRuns(50));
      return;
    }

    if (req.url === "/health") {
      writeJson(res, 200, {
        ok: true,
        server: "codex-chatgpt-hub",
        endpoint: "/mcp",
        localUrl: `http://${host}:${port}/mcp`,
        publicUrl: publicUrl ? withMcpPath(publicUrl) : undefined,
        dashboardUrl: `http://${host}:${port}/`,
        dataDir,
        workspace,
        auth: token ? "bearer" : "none",
        tools: {
          total: tools.length,
          hub: tools.filter((tool) => tool.name.startsWith("hub_")).length,
          paper: tools.filter((tool) => tool.name.startsWith("paper_")).length,
          session: tools.filter((tool) => tool.name.startsWith("session_")).length,
          run: tools.filter((tool) => tool.name.startsWith("run_")).length,
          profile: tools.filter((tool) => tool.name.startsWith("profile_")).length
        }
      });
      return;
    }

    if (!req.url?.startsWith("/mcp")) {
      writeJson(res, 404, { error: "Not found" });
      return;
    }

    if (!isAuthorized(req)) {
      writeJson(res, 401, { error: "Unauthorized" });
      return;
    }

    const sessionId = req.headers["mcp-session-id"];
    let transport: StreamableHTTPServerTransport | undefined;

    if (typeof sessionId === "string") {
      transport = sessions.get(sessionId);
      if (!transport) {
        writeJson(res, 404, { error: "Unknown MCP session" });
        return;
      }
    } else {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID()
      });

      const server = createMcpServer();
      await server.connect(transport);

      transport.onclose = () => {
        if (transport?.sessionId) {
          sessions.delete(transport.sessionId);
        }
      };
    }

    await transport.handleRequest(req, res);

    if (transport.sessionId) {
      sessions.set(transport.sessionId, transport);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (!res.headersSent) {
      writeJson(res, 500, { error: message });
    } else {
      res.end();
    }
  }
});

httpServer.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${host}:${port} is already in use.`);
    console.error("Stop the old server, or run with a different port:");
    console.error(`  MCP_HUB_HTTP_PORT=${port + 1} npm run serve`);
    process.exit(1);
  }

  throw error;
});

httpServer.listen(port, host, () => {
  console.error(`codex-chatgpt-hub HTTP MCP listening at http://${host}:${port}/mcp`);
});

function isAuthorized(req: IncomingMessage) {
  if (!token) {
    return true;
  }

  const auth = req.headers.authorization;
  return auth === `Bearer ${token}`;
}

function writeJson(res: ServerResponse, statusCode: number, body: unknown) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(body));
}

function writeText(res: ServerResponse, statusCode: number, body: string) {
  res.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8"
  });
  res.end(body);
}

function writeHtml(res: ServerResponse, statusCode: number, body: string) {
  res.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8"
  });
  res.end(body);
}

function renderHomePage() {
  const localMcpUrl = `http://${host}:${port}/mcp`;
  const connectorUrl = publicUrl ? withMcpPath(publicUrl) : localMcpUrl;
  const hubTools = tools.filter((tool) => tool.name.startsWith("hub_")).length;
  const paperTools = tools.filter((tool) => tool.name.startsWith("paper_")).length;
  const sessionTools = tools.filter((tool) => tool.name.startsWith("session_")).length;
  const runTools = tools.filter((tool) => tool.name.startsWith("run_")).length;
  const profileTools = tools.filter((tool) => tool.name.startsWith("profile_")).length;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Codex ChatGPT Hub 控制台</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f5f6f8; color: #171717; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f5f6f8; color: #171717; }
    main { max-width: 1180px; margin: 0 auto; padding: 28px 24px 52px; }
    header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 22px; }
    h1 { margin: 0 0 6px; font-size: 30px; letter-spacing: 0; }
    h2 { margin: 0 0 12px; font-size: 18px; letter-spacing: 0; }
    h3 { margin: 0 0 8px; font-size: 15px; letter-spacing: 0; }
    p { color: #555; line-height: 1.5; margin: 0; }
    button, .button { border: 1px solid #cfd5dd; background: #fff; color: #171717; border-radius: 8px; padding: 9px 12px; font: inherit; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 8px; min-height: 38px; }
    button:hover, .button:hover { background: #f0f3f7; }
    code { background: #eceff3; padding: 3px 6px; border-radius: 6px; }
    pre { overflow: auto; background: #111827; color: #f9fafb; padding: 14px; border-radius: 8px; margin: 0; max-height: 300px; }
    .toolbar { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .band { background: #fff; border: 1px solid #d9dde4; border-radius: 8px; padding: 18px; margin-top: 14px; }
    .grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 14px; }
    .span-3 { grid-column: span 3; }
    .span-4 { grid-column: span 4; }
    .span-6 { grid-column: span 6; }
    .span-8 { grid-column: span 8; }
    .span-12 { grid-column: span 12; }
    .stat { background: #fff; border: 1px solid #d9dde4; border-radius: 8px; padding: 14px; min-height: 84px; }
    .label { color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
    .value { font-size: 24px; font-weight: 700; margin-top: 6px; overflow-wrap: anywhere; }
    .sub { color: #666; font-size: 13px; margin-top: 6px; overflow-wrap: anywhere; }
    .pill { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 4px 9px; border: 1px solid #d9dde4; background: #f8fafc; font-size: 13px; }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: #9ca3af; display: inline-block; }
    .ok .dot { background: #0f9f6e; }
    .bad .dot { background: #d92d20; }
    .warn .dot { background: #d97706; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border-top: 1px solid #e5e7eb; padding: 8px 6px; text-align: left; vertical-align: top; }
    th { color: #666; font-weight: 600; }
    .muted { color: #666; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
    .split { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    @media (max-width: 860px) {
      header { display: block; }
      .toolbar { justify-content: flex-start; margin-top: 12px; }
      .span-3, .span-4, .span-6, .span-8 { grid-column: span 12; }
      .split { grid-template-columns: 1fr; }
    }
    @media (prefers-color-scheme: dark) {
      :root, body { background: #0d1117; color: #f0f3f6; }
      p, .label, .sub, .muted, th { color: #9da7b3; }
      button, .button, .band, .stat { background: #161b22; border-color: #30363d; color: #f0f3f6; }
      button:hover, .button:hover { background: #1f2630; }
      code { background: #1f2630; }
      th, td { border-color: #30363d; }
      .pill { background: #1f2630; border-color: #30363d; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Codex ChatGPT Hub</h1>
        <p>Codex 与 ChatGPT 共用的 MCP 中转站、科研记忆、执行归档和本地控制台。</p>
      </div>
      <div class="toolbar">
        <button onclick="loadDashboard()">刷新</button>
        <a class="button" href="/health">健康状态 JSON</a>
        <a class="button" href="/api/service/logs">服务日志</a>
      </div>
    </header>

    <section class="grid" id="stats">
      <div class="stat span-3"><div class="label">服务</div><div class="value">加载中</div></div>
      <div class="stat span-3"><div class="label">Tools</div><div class="value">${tools.length}</div><div class="sub">hub ${hubTools} · paper ${paperTools} · session ${sessionTools} · run ${runTools} · profile ${profileTools}</div></div>
      <div class="stat span-3"><div class="label">运行记录</div><div class="value">-</div></div>
      <div class="stat span-3"><div class="label">实验产物</div><div class="value">-</div></div>
    </section>

    <section class="band">
      <h2>连接入口</h2>
      <div class="split">
        <div>
          <h3>ChatGPT Connector URL</h3>
          <pre>${connectorUrl}</pre>
          <p class="sub">给 ChatGPT 远程连接时，用 ngrok 暴露本地服务，并设置 <code>MCP_HUB_PUBLIC_URL</code>。</p>
        </div>
        <div>
          <h3>Codex MCP Config</h3>
          <pre id="codexConfig">运行 npm run setup 生成 codex-config.generated.toml。</pre>
        </div>
      </div>
    </section>

    <section class="grid">
      <div class="band span-4">
        <h2>共享记忆</h2>
        <table id="memoryTable"></table>
      </div>
      <div class="band span-8">
        <h2>连接配置</h2>
        <table id="profilesTable"></table>
      </div>
    </section>

    <section class="grid">
      <div class="band span-12">
        <h2>最近运行记录</h2>
        <table id="runsTable"></table>
      </div>
    </section>

    <section class="grid">
      <div class="band span-6">
        <h2>产物清单</h2>
        <p class="sub">Wrapper 会为指标、图表、报告、表格、配置、checkpoint、数据集、日志等产物写入 <code>manifest.json</code>。</p>
        <pre id="artifactKinds">加载中</pre>
      </div>
      <div class="band span-6">
        <h2>维护</h2>
        <table id="maintenanceTable"></table>
      </div>
    </section>
  </main>
  <script>
    const staticConfig = {
      connectorUrl: ${JSON.stringify(connectorUrl)},
      localMcpUrl: ${JSON.stringify(localMcpUrl)}
    };

    async function loadDashboard() {
      const response = await fetch("/api/dashboard");
      const data = await response.json();
      renderStats(data);
      renderMemory(data);
      renderProfiles(data);
      renderRuns(data);
      renderMaintenance(data);
      document.getElementById("codexConfig").textContent = data.codexConfig;
    }

    function renderStats(data) {
      const serviceClass = data.service.running && data.service.health?.ok ? "ok" : data.service.running ? "warn" : "bad";
      document.getElementById("stats").innerHTML = [
        stat("服务", '<span class="pill ' + serviceClass + '"><span class="dot"></span>' + (data.service.running ? "运行中" : "已停止") + "</span>", data.service.configured.localUrl),
        stat("工具", String(data.tools.total), "hub " + data.tools.hub + " · paper " + data.tools.paper + " · session " + data.tools.session + " · run " + data.tools.run + " · profile " + data.tools.profile),
        stat("运行记录", String(data.runs.totalRuns), formatBytes(data.runs.totalSizeBytes)),
        stat("实验产物", String(totalArtifactCount(data.runs.artifactKinds)), Object.entries(data.runs.artifactKinds || {}).map(([k,v]) => artifactKindLabel(k) + " " + v).join(" · ") || "暂无")
      ].join("");
    }

    function renderMemory(data) {
      const rows = [
        ["Hub 任务", data.memory.hub.counts.tasks],
        ["论文项目", data.memory.paper.counts.projects],
        ["研究洞察", data.memory.paper.counts.insights],
        ["Codex 会话", data.memory.session.counts.sessions],
        ["会话事件", data.memory.session.counts.events]
      ];
      document.getElementById("memoryTable").innerHTML = tableRows(rows);
    }

    function renderProfiles(data) {
      const rows = (data.profiles.profiles || []).map((profile) => [
        escapeHtml(profile.name),
        '<span class="mono">' + escapeHtml(modeLabel(profile.mode)) + '</span>',
        profile.enabled ? "已启用" : "未启用",
        escapeHtml(profile.url || [profile.command, ...(profile.args || [])].filter(Boolean).join(" ")),
        escapeHtml((profile.notes || []).join(" "))
      ]);
      document.getElementById("profilesTable").innerHTML = table(["名称", "模式", "状态", "入口", "说明"], rows);
    }

    function renderRuns(data) {
      const rows = (data.recentRuns || []).slice(0, 10).map((run) => [
        '<span class="mono">' + run.runId + '</span>',
        escapeHtml((run.command || []).join(" ")),
        run.exitCode === 0 ? "通过" : "退出码 " + (run.exitCode ?? "?"),
        formatDuration(run.durationMs),
        run.artifacts?.total ?? 0
      ]);
      document.getElementById("runsTable").innerHTML = table(["Run ID", "命令", "状态", "耗时", "产物"], rows);
    }

    function renderMaintenance(data) {
      document.getElementById("artifactKinds").textContent = JSON.stringify(localizeArtifactKinds(data.runs.artifactKinds || {}), null, 2);
      const rows = [
        ["Run 索引", data.runs.index?.generatedAt || "尚未构建"],
        ["数据目录", data.service.paths.dataDir],
        ["服务日志", data.service.paths.logPath],
        ["清理预览", 'MCP tool: run_cleanup({ dryRun: true, maxAgeDays: 30, keepLast: 50 })'],
        ["实际清理", '需要 confirm: "DELETE_RUN_ARCHIVES"']
      ];
      document.getElementById("maintenanceTable").innerHTML = tableRows(rows);
    }

    function stat(label, value, sub) {
      return '<div class="stat span-3"><div class="label">' + label + '</div><div class="value">' + value + '</div><div class="sub">' + escapeHtml(sub || "") + '</div></div>';
    }

    function table(headers, rows) {
      return "<thead><tr>" + headers.map((h) => "<th>" + escapeHtml(h) + "</th>").join("") + "</tr></thead><tbody>" + rows.map((row) => "<tr>" + row.map((cell) => "<td>" + cell + "</td>").join("") + "</tr>").join("") + "</tbody>";
    }

    function tableRows(rows) {
      return "<tbody>" + rows.map(([a, b]) => "<tr><th>" + escapeHtml(String(a)) + "</th><td>" + escapeHtml(String(b ?? "")) + "</td></tr>").join("") + "</tbody>";
    }

    function totalArtifactCount(record) {
      return Object.values(record || {}).reduce((sum, value) => sum + Number(value || 0), 0);
    }

    function formatBytes(bytes) {
      const value = Number(bytes || 0);
      if (value < 1024) return value + " B";
      if (value < 1024 * 1024) return (value / 1024).toFixed(1) + " KB";
      if (value < 1024 * 1024 * 1024) return (value / 1024 / 1024).toFixed(1) + " MB";
      return (value / 1024 / 1024 / 1024).toFixed(1) + " GB";
    }

    function formatDuration(ms) {
      if (!Number.isFinite(ms)) return "";
      if (ms < 1000) return ms + " ms";
      return (ms / 1000).toFixed(1) + " s";
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
    }

    function artifactKindLabel(kind) {
      const labels = {
        metrics: "指标",
        figure: "图表",
        report: "报告",
        table: "表格",
        config: "配置",
        checkpoint: "Checkpoint",
        dataset: "数据集",
        log: "日志",
        other: "其他"
      };
      return labels[kind] || kind;
    }

    function localizeArtifactKinds(record) {
      return Object.fromEntries(Object.entries(record).map(([key, value]) => [artifactKindLabel(key), value]));
    }

    function modeLabel(mode) {
      const labels = {
        "codex-stdio": "Codex 本地",
        "chatgpt-http": "ChatGPT HTTP",
        "api-relay": "API 中继",
        "hybrid-relay": "混合中继"
      };
      return labels[mode] || mode;
    }

    loadDashboard().catch((error) => {
      document.getElementById("stats").innerHTML = '<div class="stat span-12"><div class="label">控制台错误</div><div class="value">' + escapeHtml(error.message) + '</div></div>';
    });
  </script>
</body>
</html>`;
}

function withMcpPath(url: string) {
  const trimmed = url.replace(/\/+$/, "");
  return trimmed.endsWith("/mcp") ? trimmed : `${trimmed}/mcp`;
}

async function dashboardPayload() {
  const [hub, paper, session, runs, recentRuns, service, profiles] = await Promise.all([
    getHubOverview(),
    getPaperOverview(),
    getSessionOverview(),
    getRunOverview(),
    listRuns(20),
    getServiceStatus(projectRoot, serviceEnv()),
    getProfileOverview()
  ]);

  return {
    service,
    memory: {
      hub,
      paper,
      session
    },
    runs,
    recentRuns,
    profiles,
    tools: {
      total: tools.length,
      hub: tools.filter((tool) => tool.name.startsWith("hub_")).length,
      paper: tools.filter((tool) => tool.name.startsWith("paper_")).length,
      session: tools.filter((tool) => tool.name.startsWith("session_")).length,
      run: tools.filter((tool) => tool.name.startsWith("run_")).length,
      profile: tools.filter((tool) => tool.name.startsWith("profile_")).length
    },
    codexConfig: renderCodexConfig()
  };
}

function serviceEnv() {
  return {
    MCP_HUB_DATA_DIR: dataDir,
    MCP_HUB_WORKSPACE: workspace,
    MCP_HUB_HTTP_HOST: host,
    MCP_HUB_HTTP_PORT: String(port),
    MCP_HUB_HTTP_TOKEN: token,
    MCP_HUB_PUBLIC_URL: publicUrl
  };
}

function renderCodexConfig() {
  return `[mcp_servers.codex-chatgpt-hub]
command = "node"
args = ["${resolve(projectRoot, "dist/index.js")}"]
startup_timeout_sec = 10

[mcp_servers.codex-chatgpt-hub.env]
MCP_HUB_DATA_DIR = "${dataDir}"
MCP_HUB_WORKSPACE = "${workspace}"
`;
}
