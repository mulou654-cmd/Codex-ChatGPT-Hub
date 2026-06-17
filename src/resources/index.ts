import type { ReadResourceResult, Resource } from "@modelcontextprotocol/sdk/types.js";

import { getHubOverview } from "../hub/store.js";

const statusUri = "mcp://codex-chatgpt-hub/status";
const overviewUri = "mcp://codex-chatgpt-hub/overview";

export const resources: Resource[] = [
  {
    uri: statusUri,
    name: "Server status",
    description: "Runtime information for the collaboration hub.",
    mimeType: "application/json"
  },
  {
    uri: overviewUri,
    name: "Hub overview",
    description: "Current task, context, plan, execution, and workspace snapshot counts.",
    mimeType: "application/json"
  }
];

export async function readResource(uri: string): Promise<ReadResourceResult> {
  if (uri === overviewUri) {
    return {
      contents: [
        {
          uri: overviewUri,
          mimeType: "application/json",
          text: JSON.stringify(await getHubOverview(), null, 2)
        }
      ]
    };
  }

  if (uri !== statusUri) {
    return {
      contents: [
        {
          uri,
          mimeType: "text/plain",
          text: `Unknown resource: ${uri}`
        }
      ]
    };
  }

  return {
    contents: [
      {
        uri: statusUri,
        mimeType: "application/json",
        text: JSON.stringify(
          {
            ok: true,
            server: "codex-chatgpt-hub",
            pid: process.pid,
            cwd: process.cwd(),
            node: process.version,
            startedAt: new Date().toISOString()
          },
          null,
          2
        )
      }
    ]
  };
}
