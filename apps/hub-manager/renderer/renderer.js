let state;
let currentView = "overview";

const viewMeta = {
  overview: ["概览", "检查 Hub 状态、当前空间和连接入口"],
  spaces: ["记忆空间", "切换项目共享记忆，避免不同任务互相污染"],
  worker: ["自动执行", "让 Codex 可见地执行 ChatGPT 投递的 codex-auto 任务"],
  connections: ["连接状态", "查看 Codex、ChatGPT Connector 和 tunnel 配置"],
  logs: ["日志", "查看服务日志和操作输出"],
  settings: ["设置", "项目路径、数据目录和工具列表"]
};

document.addEventListener("DOMContentLoaded", () => {
  bindNavigation();
  bindActions();
  refresh();
});

function bindNavigation() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      currentView = button.dataset.view;
      document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item === button));
      document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === `view-${currentView}`));
      const [title, subtitle] = viewMeta[currentView];
      text("pageTitle", title);
      text("pageSubtitle", subtitle);
    });
  });
}

function bindActions() {
  document.getElementById("refreshButton").addEventListener("click", refresh);
  document.getElementById("saveSpaceButton").addEventListener("click", saveSpace);
  document.getElementById("openSpacePath").addEventListener("click", () => openPath(state?.config?.spaceDataDir));
  document.getElementById("openProjectPath").addEventListener("click", () => openPath(state?.projectRoot));
  document.getElementById("openDataPath").addEventListener("click", () => openPath(state?.config?.dataDir));
  document.getElementById("spaceSelect").addEventListener("change", (event) => {
    document.getElementById("spaceInput").value = event.target.value;
  });

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => runAction(button.dataset.action));
  });
  document.querySelectorAll("[data-worker-mode]").forEach((button) => {
    button.addEventListener("click", () => runWorkerTerminal(button.dataset.workerMode));
  });
}

async function refresh() {
  setBusy(true);
  try {
    state = await unwrap(window.hubManager.getState());
    render();
  } catch (error) {
    renderError(error);
  } finally {
    setBusy(false);
  }
}

async function saveSpace() {
  const input = document.getElementById("spaceInput");
  const nextSpace = input.value.trim();

  if (!nextSpace) {
    writeOutput("请输入空间名。");
    return;
  }

  setBusy(true);
  try {
    state = await unwrap(window.hubManager.setSpace(nextSpace));
    writeOutput([
      `已切换 .env 记忆空间为 ${state.config.memorySpace}`,
      `空间目录：${state.config.spaceDataDir}`,
      "",
      "请执行“更新 Codex 配置”和“重启 Hub 服务”。"
    ].join("\n"));
    render();
  } catch (error) {
    writeOutput(error.message);
  } finally {
    setBusy(false);
  }
}

async function runAction(action) {
  setBusy(true);
  writeOutput(`正在执行：${action} ...`);
  try {
    const result = await unwrap(window.hubManager.runAction(action));
    state = result.state;
    writeOutput(result.output || "命令执行完成。");
    render();
  } catch (error) {
    writeOutput(error.message);
  } finally {
    setBusy(false);
  }
}

async function runWorkerTerminal(mode) {
  setBusy(true);
  writeWorkerOutput(`正在打开 Codex worker 可见终端：${mode} ...`);
  writeOutput(`正在打开 Codex worker 可见终端：${mode} ...`);
  try {
    const result = await unwrap(window.hubManager.runWorkerTerminal(mode));
    state = result.state;
    const message = result.output || "已打开 Codex worker 终端。";
    writeWorkerOutput(message);
    writeOutput(message);
    render();
  } catch (error) {
    writeWorkerOutput(error.message);
    writeOutput(error.message);
  } finally {
    setBusy(false);
  }
}

async function openPath(targetPath) {
  if (!targetPath) {
    return;
  }

  try {
    await unwrap(window.hubManager.openPath(targetPath));
  } catch (error) {
    writeOutput(error.message);
  }
}

async function openUrl(url) {
  if (!url) {
    return;
  }

  try {
    await unwrap(window.hubManager.openExternal(url));
  } catch (error) {
    writeOutput(error.message);
  }
}

function render() {
  if (!state) {
    return;
  }

  const { config, service, dashboard } = state;
  const dashboardBody = dashboard?.body;
  const serviceOk = service?.ok === true;
  const publicReady = Boolean(config.connectorUrl);

  text("currentSpace", config.memorySpace);
  text("spacePath", config.spaceDataDir);
  text("serviceStatus", serviceOk ? "运行中" : "未连接");
  text("serviceUrl", config.localMcpUrl);
  text("connectorStatus", publicReady ? "已配置" : "未配置");
  text("connectorUrl", config.connectorUrl || "需要启动 ngrok 或设置 MCP_HUB_PUBLIC_URL");
  text("authStatus", config.auth === "bearer" ? "Bearer" : "No Auth");

  renderHealthChecks([
    ["HTTP MCP", serviceOk, serviceOk ? "健康检查通过" : service?.error || "无法访问 /health"],
    ["当前空间", true, `${config.memorySpace} -> ${config.spaceDataDir}`],
    ["Codex 配置", /Installed:\s+yes/i.test(state.codexConfig), trimForLine(state.codexConfig)],
    ["ChatGPT Connector", publicReady, publicReady ? config.connectorUrl : "启动 tunnel 后会生成公网地址"],
    ["Dashboard", dashboard?.ok === true, dashboard?.ok ? config.dashboardUrl : dashboard?.error || "未连接"]
  ]);

  renderMemoryMetrics(dashboardBody);
  renderSpaces();
  renderWorker();
  renderConnections();
  renderSettings();

  text("codexConfigText", state.codexConfig || "");
  text("tunnelStatusText", state.tunnelStatus || "");
  text("serviceLogs", state.logs || "暂无日志。");
  text("workerLogs", state.workerLogs || "暂无 worker 日志。");
}

function renderHealthChecks(items) {
  const root = document.getElementById("healthChecks");
  root.innerHTML = items.map(([name, ok, detail]) => `
    <div class="check-row ${ok ? "ok" : "warn"}">
      <div class="status-dot"></div>
      <div>
        <strong>${escapeHtml(name)}</strong>
        <div class="hint">${escapeHtml(detail || "")}</div>
      </div>
      <span class="tag ${ok ? "ok" : ""}">${ok ? "正常" : "待处理"}</span>
    </div>
  `).join("");
}

function renderMemoryMetrics(dashboardBody) {
  const counts = dashboardBody?.memory;
  const runs = dashboardBody?.runs;
  const metrics = [
    ["Hub 任务", counts?.hub?.counts?.tasks ?? 0],
    ["论文项目", counts?.paper?.counts?.projects ?? 0],
    ["研究洞察", counts?.paper?.counts?.insights ?? 0],
    ["会话事件", counts?.session?.counts?.events ?? 0],
    ["运行记录", runs?.totalRuns ?? 0]
  ];
  const root = document.getElementById("memoryMetrics");
  root.innerHTML = metrics.map(([name, value]) => `
    <div class="metric-card">
      <span class="label">${escapeHtml(name)}</span>
      <strong>${escapeHtml(String(value))}</strong>
    </div>
  `).join("");
}

function renderSpaces() {
  const select = document.getElementById("spaceSelect");
  select.innerHTML = state.spaces.map((space) => `<option value="${escapeHtml(space)}">${escapeHtml(space)}</option>`).join("");
  select.value = state.config.memorySpace;
  document.getElementById("spaceInput").value = state.config.memorySpace;

  const root = document.getElementById("spaceList");
  root.innerHTML = state.spaces.map((space) => {
    const active = space === state.config.memorySpace;
    return `
      <div class="space-item ${active ? "ok" : ""}">
        <div class="status-dot"></div>
        <div>
          <strong>${escapeHtml(space)}</strong>
          <div class="hint">${active ? escapeHtml(state.config.spaceDataDir) : ".data/spaces/" + escapeHtml(space)}</div>
        </div>
        <span class="tag ${active ? "ok" : ""}">${active ? "当前" : "可切换"}</span>
      </div>
    `;
  }).join("");
}

function renderWorker() {
  const status = state.workerStatus || "";
  const running = /Codex worker:\s+running/i.test(status);
  text("workerRunning", running ? "运行中" : "未运行");
  text("workerSpace", `当前空间：${state.config.memorySpace}`);
  text("workerStatusText", status || "暂无 worker 状态。");
}

function renderConnections() {
  const rows = [
    ["本地 MCP", state.config.localMcpUrl, "打开", () => openUrl(state.config.localMcpUrl)],
    ["Dashboard", state.config.dashboardUrl, "打开", () => openUrl(state.config.dashboardUrl)],
    ["Connector URL", state.config.connectorUrl || "未配置", state.config.connectorUrl ? "打开" : "", () => openUrl(state.config.connectorUrl)],
    ["认证方式", state.config.auth === "bearer" ? "Bearer token" : "No Auth", "", undefined],
    ["数据目录", state.config.dataDir, "打开", () => openPath(state.config.dataDir)],
    ["空间目录", state.config.spaceDataDir, "打开", () => openPath(state.config.spaceDataDir)]
  ];
  renderInfoTable("connectionTable", rows);
}

function renderSettings() {
  renderInfoTable("settingsTable", [
    ["项目根目录", state.projectRoot, "打开", () => openPath(state.projectRoot)],
    [".env", state.envPath, "", undefined],
    ["Workspace", state.config.workspace, "打开", () => openPath(state.config.workspace)],
    ["Data Dir", state.config.dataDir, "打开", () => openPath(state.config.dataDir)],
    ["Memory Space", state.config.memorySpace, "", undefined]
  ]);
}

function renderInfoTable(elementId, rows) {
  const root = document.getElementById(elementId);
  root.innerHTML = "";

  for (const [name, value, actionLabel, action] of rows) {
    const row = document.createElement("div");
    row.className = "info-row";
    row.innerHTML = `
      <div class="name">${escapeHtml(name)}</div>
      <div class="data">${escapeHtml(value || "-")}</div>
      <div></div>
    `;

    if (actionLabel && action) {
      const button = document.createElement("button");
      button.className = "button ghost";
      button.textContent = actionLabel;
      button.addEventListener("click", action);
      row.lastElementChild.appendChild(button);
    }

    root.appendChild(row);
  }
}

function renderError(error) {
  writeOutput(error.message);
  renderHealthChecks([["管理器", false, error.message]]);
}

function writeOutput(value) {
  text("actionOutput", value || "");
}

function writeWorkerOutput(value) {
  text("workerActionOutput", value || "");
}

function setBusy(isBusy) {
  document.querySelectorAll("button, input, select").forEach((element) => {
    element.disabled = isBusy;
  });
}

async function unwrap(promise) {
  const result = await promise;

  if (result && typeof result === "object" && "ok" in result) {
    if (result.ok) {
      return result.value;
    }

    throw new Error(result.error || "操作失败。");
  }

  return result;
}

function text(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value ?? "";
  }
}

function trimForLine(value) {
  return String(value || "").split(/\r?\n/).filter(Boolean).slice(0, 2).join(" | ");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}
