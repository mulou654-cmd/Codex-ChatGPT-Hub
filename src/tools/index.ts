import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

import { hubHandlers, hubTools } from "./hub.js";
import { helloCodexTool, runHelloCodex } from "./hello-codex.js";
import { paperHandlers, paperTools } from "./paper.js";
import { profileHandlers, profileTools } from "./profile.js";
import { runHandlers, runTools } from "./run.js";
import { sessionHandlers, sessionTools } from "./session.js";

type ToolHandler = (args: unknown) => Promise<CallToolResult>;

const handlers: Record<string, ToolHandler> = {
  ...hubHandlers,
  ...paperHandlers,
  ...sessionHandlers,
  ...runHandlers,
  ...profileHandlers,
  [helloCodexTool.name]: runHelloCodex
};

export const tools: Tool[] = [...hubTools, ...paperTools, ...sessionTools, ...runTools, ...profileTools, helloCodexTool];

export async function callTool(name: string, args: unknown): Promise<CallToolResult> {
  const handler = handlers[name];

  if (!handler) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Unknown tool: ${name}`
        }
      ]
    };
  }

  try {
    return await handler(args);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      isError: true,
      content: [
        {
          type: "text",
          text: message
        }
      ]
    };
  }
}
