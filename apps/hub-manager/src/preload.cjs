const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hubManager", {
  getState: () => ipcRenderer.invoke("hub:get-state"),
  setSpace: (space) => ipcRenderer.invoke("hub:set-space", space),
  runAction: (action) => ipcRenderer.invoke("hub:run-action", action),
  runWorkerTerminal: (mode) => ipcRenderer.invoke("hub:run-worker-terminal", mode),
  openExternal: (target) => ipcRenderer.invoke("hub:open-external", target),
  openPath: (targetPath) => ipcRenderer.invoke("hub:open-path", targetPath)
});
