import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

import { getProfileOverview, listConnectionProfiles } from "../profile/store.js";

export const profileTools: Tool[] = [
  {
    name: "profile_list",
    description: "List local connection profiles for Codex stdio, ChatGPT HTTP, API relay, and hybrid relay foundations.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "profile_overview",
    description: "Read counts and grouped overview for configured connection profiles.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  }
];

export const profileHandlers: Record<string, () => Promise<CallToolResult>> = {
  profile_list: async () => jsonResult(await listConnectionProfiles()),
  profile_overview: async () => jsonResult(await getProfileOverview())
};

function jsonResult(value: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}
