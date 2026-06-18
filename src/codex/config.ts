import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const MANAGED_START = "# BEGIN CODEX CHATGPT HUB MANAGED MCP";
export const MANAGED_END = "# END CODEX CHATGPT HUB MANAGED MCP";

export interface CodexConfigEnv {
  MCP_HUB_DATA_DIR: string;
  MCP_HUB_MEMORY_SPACE?: string;
  MCP_HUB_WORKSPACE: string;
}

export interface CodexConfigInstallInput {
  projectRoot: string;
  env: CodexConfigEnv;
  configPath?: string;
  serverName?: string;
  dryRun?: boolean;
}

export interface CodexConfigStatus {
  configPath: string;
  exists: boolean;
  installed: boolean;
  serverName?: string;
  managedBlock?: string;
}

export function defaultCodexConfigPath() {
  return path.join(os.homedir(), ".codex", "config.toml");
}

export async function getCodexConfigStatus(configPath = defaultCodexConfigPath()): Promise<CodexConfigStatus> {
  const current = await readConfig(configPath);
  const managedBlock = extractManagedBlock(current);
  const serverName = managedBlock ? findManagedServerName(managedBlock) : undefined;

  return {
    configPath,
    exists: existsSync(configPath),
    installed: Boolean(managedBlock),
    serverName,
    managedBlock
  };
}

export async function installCodexConfig(input: CodexConfigInstallInput) {
  const configPath = input.configPath ?? defaultCodexConfigPath();
  const current = await readConfig(configPath);
  const block = renderManagedBlock(input);
  const next = mergeManagedBlock(current, block);
  const changed = next !== current;

  if (!input.dryRun && changed) {
    await mkdir(path.dirname(configPath), { recursive: true });
    if (existsSync(configPath)) {
      const backupPath = `${configPath}.bak.${timestampForFile()}`;
      await copyFile(configPath, backupPath);
    }
    await writeFile(configPath, next, "utf8");
  }

  return {
    configPath,
    changed,
    dryRun: input.dryRun === true,
    block,
    preview: next
  };
}

export async function removeCodexConfig(configPath = defaultCodexConfigPath(), dryRun = false) {
  const current = await readConfig(configPath);
  const next = stripManagedBlock(current).trimEnd();
  const output = next ? `${next}\n` : "";
  const changed = output !== current;

  if (!dryRun && changed) {
    await mkdir(path.dirname(configPath), { recursive: true });
    if (existsSync(configPath)) {
      const backupPath = `${configPath}.bak.${timestampForFile()}`;
      await copyFile(configPath, backupPath);
    }
    await writeFile(configPath, output, "utf8");
  }

  return {
    configPath,
    changed,
    dryRun,
    preview: output
  };
}

export function renderManagedBlock(input: Pick<CodexConfigInstallInput, "projectRoot" | "env" | "serverName">) {
  const serverName = input.serverName ?? "codex-chatgpt-hub";
  return [
    MANAGED_START,
    `[mcp_servers.${formatTomlKey(serverName)}]`,
    'command = "node"',
    `args = ${formatTomlStringArray([path.join(input.projectRoot, "dist/index.js")])}`,
    "startup_timeout_sec = 10",
    "",
    `[mcp_servers.${formatTomlKey(serverName)}.env]`,
    `MCP_HUB_DATA_DIR = ${formatTomlString(input.env.MCP_HUB_DATA_DIR)}`,
    `MCP_HUB_MEMORY_SPACE = ${formatTomlString(input.env.MCP_HUB_MEMORY_SPACE ?? "default")}`,
    `MCP_HUB_WORKSPACE = ${formatTomlString(input.env.MCP_HUB_WORKSPACE)}`,
    MANAGED_END
  ].join("\n");
}

export function mergeManagedBlock(currentToml: string, managedBlock: string) {
  const stripped = stripManagedBlock(currentToml).trimEnd();
  return `${stripped ? `${stripped}\n\n` : ""}${managedBlock}\n`;
}

export function stripManagedBlock(toml: string) {
  const pattern = new RegExp(
    `\\n?${escapeRegExp(MANAGED_START)}[\\s\\S]*?${escapeRegExp(MANAGED_END)}\\n?`,
    "g"
  );
  return toml.replace(pattern, "\n").replace(/\n{3,}/g, "\n\n");
}

async function readConfig(configPath: string) {
  try {
    return await readFile(configPath, "utf8");
  } catch (error: unknown) {
    if (isMissingFile(error)) {
      return "";
    }

    throw error;
  }
}

function extractManagedBlock(toml: string) {
  const pattern = new RegExp(`${escapeRegExp(MANAGED_START)}[\\s\\S]*?${escapeRegExp(MANAGED_END)}`);
  return toml.match(pattern)?.[0];
}

function findManagedServerName(block: string) {
  const match = block.match(/^\s*\[mcp_servers\.([^\]\s]+)\]\s*$/m);
  return match?.[1] ? unquoteTomlKey(match[1]) : undefined;
}

function formatTomlString(value: string) {
  return JSON.stringify(value);
}

function formatTomlStringArray(values: string[]) {
  return `[${values.map(formatTomlString).join(", ")}]`;
}

function formatTomlKey(key: string) {
  return /^[a-zA-Z0-9_-]+$/.test(key) ? key : formatTomlString(key);
}

function unquoteTomlKey(key: string) {
  if (!key.startsWith('"') || !key.endsWith('"')) {
    return key;
  }

  try {
    return JSON.parse(key) as string;
  } catch {
    return key;
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function isMissingFile(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
}
