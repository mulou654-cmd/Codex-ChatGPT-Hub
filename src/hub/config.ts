import path from "node:path";

export const workspaceRoot = path.resolve(process.env.MCP_HUB_WORKSPACE ?? process.cwd());
export const dataDir = path.resolve(process.env.MCP_HUB_DATA_DIR ?? path.join(process.cwd(), ".data"));
export const statePath = path.join(dataDir, "hub-state.json");
