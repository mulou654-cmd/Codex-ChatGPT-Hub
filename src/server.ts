import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

import { getPrompt, prompts } from "./prompts/index.js";
import { readResource, resources } from "./resources/index.js";
import { callTool, tools } from "./tools/index.js";

export function createMcpServer() {
  const server = new Server(
    {
      name: "codex-chatgpt-hub",
      version: "0.1.0"
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {}
      },
      instructions: [
        "This MCP server is a collaboration hub shared by Codex and ChatGPT.",
        "Use hub_* tools to persist task briefs, context, plans, execution results, and workspace snapshots.",
        "For paper_* tools, every claim must include evidence, every framework must include justification, and every section must include a related-work anchor so the other agent can inspect the reasoning trail."
      ].join(" ")
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return callTool(request.params.name, request.params.arguments ?? {});
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    return readResource(request.params.uri);
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    return getPrompt(request.params.name, request.params.arguments ?? {});
  });

  return server;
}
