import path from "node:path";

export const workspaceRoot = path.resolve(process.env.MCP_HUB_WORKSPACE ?? process.cwd());
export const dataDir = path.resolve(process.env.MCP_HUB_DATA_DIR ?? path.join(process.cwd(), ".data"));
export const memorySpace = sanitizeMemorySpace(process.env.MCP_HUB_MEMORY_SPACE ?? "default");
export const spaceDataDir = resolveSpaceDataDir(dataDir, memorySpace);
export const statePath = path.join(spaceDataDir, "hub-state.json");

export function resolveSpaceDataDir(rootDataDir: string, space: string) {
  const normalized = sanitizeMemorySpace(space);
  const absoluteRoot = path.resolve(rootDataDir);
  return normalized === "default" ? absoluteRoot : path.join(absoluteRoot, "spaces", normalized);
}

export function sanitizeMemorySpace(value: string) {
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
