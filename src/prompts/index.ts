import type { GetPromptResult, Prompt } from "@modelcontextprotocol/sdk/types.js";

import { readOptionalString } from "../utils/input.js";

export const prompts: Prompt[] = [
  {
    name: "hub-collaboration-brief",
    description: "Create a concise collaboration brief for Codex and ChatGPT.",
    arguments: [
      {
        name: "task",
        description: "The task Codex should work on.",
        required: true
      }
    ]
  }
];

export async function getPrompt(name: string, args: unknown): Promise<GetPromptResult> {
  if (name !== "hub-collaboration-brief") {
    return {
      description: `Unknown prompt: ${name}`,
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Unknown prompt: ${name}`
          }
        }
      ]
    };
  }

  const task = readOptionalString(args, "task") ?? "Describe the implementation task.";

  return {
    description: "A compact task brief for the shared hub.",
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: [
            "Please coordinate on the following task through the shared MCP hub.",
            "",
            `Task: ${task}`,
            "",
            "Use hub tools to record context, plans, execution results, and decisions.",
            "Before editing, inspect the relevant files. After editing, run the most focused verification command available."
          ].join("\n")
        }
      }
    ]
  };
}
