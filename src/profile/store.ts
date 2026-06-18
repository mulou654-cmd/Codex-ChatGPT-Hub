import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { dataDir, memorySpace, spaceDataDir, workspaceRoot } from "../hub/config.js";

export type ConnectionProfileMode = "codex-stdio" | "chatgpt-http" | "api-relay" | "hybrid-relay";

export interface ConnectionProfile {
  id: string;
  name: string;
  mode: ConnectionProfileMode;
  enabled: boolean;
  description: string;
  command?: string;
  args?: string[];
  url?: string;
  auth?: "none" | "bearer";
  env?: Record<string, string>;
  notes?: string[];
  createdAt: string;
  updatedAt: string;
}

interface ProfileState {
  version: 1;
  createdAt: string;
  updatedAt: string;
  profiles: ConnectionProfile[];
}

const profileStatePath = path.join(spaceDataDir, "profile-state.json");

export async function listConnectionProfiles() {
  const state = await loadProfileState();
  return state.profiles;
}

export async function getProfileOverview() {
  const profiles = await listConnectionProfiles();
  const byMode = profiles.reduce<Record<string, number>>((acc, profile) => {
    acc[profile.mode] = (acc[profile.mode] ?? 0) + 1;
    return acc;
  }, {});

  return {
    counts: {
      profiles: profiles.length,
      enabled: profiles.filter((profile) => profile.enabled).length
    },
    byMode,
    profiles
  };
}

async function loadProfileState(): Promise<ProfileState> {
  if (!existsSync(profileStatePath)) {
    const state = defaultProfileState();
    await saveProfileState(state);
    return state;
  }

  const raw = await readFile(profileStatePath, "utf8");
  return normalizeProfileState(JSON.parse(raw) as Partial<ProfileState>);
}

async function saveProfileState(state: ProfileState) {
  await mkdir(spaceDataDir, { recursive: true });
  state.updatedAt = new Date().toISOString();
  const tempPath = path.join(spaceDataDir, `profile-state.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tempPath, profileStatePath);
}

function defaultProfileState(): ProfileState {
  const now = new Date().toISOString();
  const host = process.env.MCP_HUB_HTTP_HOST ?? "127.0.0.1";
  const port = process.env.MCP_HUB_HTTP_PORT ?? "3333";
  const token = process.env.MCP_HUB_HTTP_TOKEN;
  const publicUrl = process.env.MCP_HUB_PUBLIC_URL;
  const httpUrl = `http://${host}:${port}/mcp`;
  const publicMcpUrl = publicUrl ? `${publicUrl.replace(/\/+$/, "")}/mcp` : undefined;

  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    profiles: [
      {
        id: "profile_codex_stdio",
        name: "Codex 本地 stdio",
        mode: "codex-stdio",
        enabled: true,
        description: "本地 Codex 通过 stdio 读取 MCP server。",
        command: "node",
        args: [path.join(process.cwd(), "dist/index.js")],
        env: {
          MCP_HUB_DATA_DIR: dataDir,
          MCP_HUB_MEMORY_SPACE: memorySpace,
          MCP_HUB_WORKSPACE: workspaceRoot
        },
        notes: [`使用 codex-config.generated.toml 中的配置片段；当前记忆空间为 ${memorySpace}。`],
        createdAt: now,
        updatedAt: now
      },
      {
        id: "profile_chatgpt_http",
        name: "ChatGPT Connector HTTP",
        mode: "chatgpt-http",
        enabled: true,
        description: "ChatGPT 通过 Streamable HTTP 访问同一份 MCP 记忆。",
        url: publicMcpUrl ?? httpUrl,
        auth: token ? "bearer" : "none",
        notes: publicMcpUrl
          ? ["已配置公网 HTTPS 地址。"]
          : ["用 ngrok 或 Cloudflare Tunnel 暴露本地地址，供远程 ChatGPT 使用。"],
        createdAt: now,
        updatedAt: now
      },
      {
        id: "profile_api_relay",
        name: "API 中继基础配置",
        mode: "api-relay",
        enabled: false,
        description: "为后续 API 驱动的头脑风暴或论文写作子代理预留。",
        url: httpUrl,
        auth: token ? "bearer" : "none",
        notes: ["不是浏览器会话封装；用于官方 API client 或本地兼容网关。"],
        createdAt: now,
        updatedAt: now
      },
      {
        id: "profile_hybrid_relay",
        name: "混合中继基础配置",
        mode: "hybrid-relay",
        enabled: false,
        description: "为 ChatGPT 规划、Codex 执行和可选 API 子代理共享同一个 Hub 的混合流程预留。",
        url: publicMcpUrl ?? httpUrl,
        auth: token ? "bearer" : "none",
        notes: ["当 ChatGPT Connector 需要和 API worker 或本地实验 agent 组合使用时启用。"],
        createdAt: now,
        updatedAt: now
      }
    ]
  };
}

function normalizeProfileState(input: Partial<ProfileState>): ProfileState {
  const fallback = defaultProfileState();
  return {
    version: 1,
    createdAt: input.createdAt ?? fallback.createdAt,
    updatedAt: input.updatedAt ?? fallback.updatedAt,
    profiles: Array.isArray(input.profiles) && input.profiles.length > 0 ? input.profiles.map(normalizeProfile) : fallback.profiles
  };
}

function normalizeProfile(input: Partial<ConnectionProfile>): ConnectionProfile {
  const now = new Date().toISOString();
  return {
    id: input.id ?? `profile_${Date.now().toString(36)}`,
    name: input.name ?? "Unnamed profile",
    mode: isMode(input.mode) ? input.mode : "hybrid-relay",
    enabled: input.enabled === true,
    description: input.description ?? "",
    command: input.command,
    args: input.args?.filter((item): item is string => typeof item === "string"),
    url: input.url,
    auth: input.auth === "bearer" ? "bearer" : "none",
    env: input.env,
    notes: input.notes?.filter((item): item is string => typeof item === "string"),
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now
  };
}

function isMode(value: unknown): value is ConnectionProfileMode {
  return value === "codex-stdio" || value === "chatgpt-http" || value === "api-relay" || value === "hybrid-relay";
}
