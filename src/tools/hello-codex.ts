import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

import { readOptionalString } from "../utils/input.js";

export const helloCodexTool: Tool = {
  name: "hello_codex",
  description: "Return a friendly greeting from this MCP server. Useful as a smoke test.",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Who should be greeted."
      }
    },
    additionalProperties: false
  }
};

export async function runHelloCodex(args: unknown): Promise<CallToolResult> {
  const name = readOptionalString(args, "name") ?? "Codex";

  return {
    content: [
      {
        type: "text",
        text: `你好，${name}！这是来自 codex-chatgpt-hub 的 MCP tool 响应。`
      }
    ]
  };
}
