const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");

const { createHubCore, findProjectRoot, normalizeConfig, readEnvFile, sanitizeMemorySpace } = require("./hub-core.cjs");

let mainWindow;
let hubCore;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 980,
    minHeight: 700,
    title: "Codex ChatGPT Hub Manager",
    backgroundColor: "#f4f6f8",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
}

app.whenReady().then(() => {
  hubCore = createHubCore(findProjectRoot([
    process.cwd(),
    path.dirname(process.execPath),
    __dirname,
    app.isPackaged ? app.getAppPath() : undefined
  ]));
  registerIpcHandlers();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

function registerIpcHandlers() {
  ipcMain.handle("hub:get-state", async () => safeReply(() => hubCore.readManagerState()));
  ipcMain.handle("hub:set-space", async (_event, space) => safeReply(() => hubCore.setMemorySpace(sanitizeMemorySpace(String(space ?? "")))));
  ipcMain.handle("hub:run-action", async (_event, action) => safeReply(() => hubCore.runAction(String(action ?? ""))));
  ipcMain.handle("hub:run-worker-terminal", async (_event, mode) => safeReply(() => hubCore.runWorkerTerminal(String(mode ?? ""))));
  ipcMain.handle("hub:open-external", async (_event, target) => safeReply(() => openExternal(String(target ?? ""))));
  ipcMain.handle("hub:open-path", async (_event, targetPath) => safeReply(() => openPath(String(targetPath ?? ""))));
}

async function safeReply(callback) {
  try {
    return {
      ok: true,
      value: await callback()
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function openExternal(target) {
  if (!/^https?:\/\//.test(target)) {
    throw new Error("Only http(s) URLs can be opened.");
  }

  await shell.openExternal(target);
}

async function openPath(targetPath) {
  const absolutePath = path.resolve(targetPath);
  const env = await readEnvFile(hubCore.envPath);
  const config = normalizeConfig(hubCore.projectRoot, env);
  const allowedRoots = [hubCore.projectRoot, config.dataDir, config.workspace];
  const allowed = allowedRoots.some((root) => absolutePath === root || absolutePath.startsWith(`${root}${path.sep}`));

  if (!allowed) {
    throw new Error(`Refusing to open path outside project: ${targetPath}`);
  }

  await shell.openPath(absolutePath);
}
