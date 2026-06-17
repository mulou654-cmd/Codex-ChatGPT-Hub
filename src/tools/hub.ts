import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

import {
  addWorkspaceSnapshot,
  appendContext,
  createTask,
  getHubOverview,
  getTaskBriefing,
  listTasks,
  postExecutionResult,
  postPlan,
  updateTaskStatus
} from "../hub/store.js";
import type {
  HubActor,
  HubContextKind,
  HubExecutionStatus,
  HubPlanStatus,
  HubTaskStatus
} from "../hub/types.js";
import { collectWorkspaceSnapshot, readWorkspaceFile, searchWorkspace } from "../hub/workspace.js";
import {
  readBoolean,
  readNumber,
  readOptionalString,
  readString,
  readStringArray
} from "../utils/input.js";

const actorEnum = ["codex", "chatgpt", "user", "system"];
const taskStatusEnum = ["open", "planned", "executing", "blocked", "done", "archived"];
const contextKindEnum = ["conversation", "requirement", "constraint", "file_summary", "decision", "log", "note"];
const planStatusEnum = ["proposed", "accepted", "superseded"];
const executionStatusEnum = ["started", "progress", "passed", "failed", "blocked", "done"];

export const hubTools: Tool[] = [
  {
    name: "hub_create_task",
    description: "Create a shared collaboration task for Codex and ChatGPT.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short task title." },
        description: { type: "string", description: "Task details, goals, constraints, and success criteria." },
        createdBy: { type: "string", enum: actorEnum },
        tags: { type: "array", items: { type: "string" } }
      },
      required: ["title"],
      additionalProperties: false
    }
  },
  {
    name: "hub_list_tasks",
    description: "List recent shared collaboration tasks.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: taskStatusEnum },
        limit: { type: "number", description: "Maximum number of tasks to return." }
      },
      additionalProperties: false
    }
  },
  {
    name: "hub_update_task_status",
    description: "Update the status of a collaboration task.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        status: { type: "string", enum: taskStatusEnum }
      },
      required: ["taskId", "status"],
      additionalProperties: false
    }
  },
  {
    name: "hub_append_context",
    description: "Append conversation context, requirements, decisions, logs, or file summaries to the shared hub.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        kind: { type: "string", enum: contextKindEnum },
        actor: { type: "string", enum: actorEnum },
        text: { type: "string" },
        source: { type: "string", description: "Optional source label, such as codex-thread, chatgpt, or a file path." }
      },
      required: ["text"],
      additionalProperties: false
    }
  },
  {
    name: "hub_post_plan",
    description: "Post a ChatGPT or Codex plan for a task.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        actor: { type: "string", enum: actorEnum },
        title: { type: "string" },
        plan: { type: "string" },
        status: { type: "string", enum: planStatusEnum }
      },
      required: ["taskId", "plan"],
      additionalProperties: false
    }
  },
  {
    name: "hub_post_execution_result",
    description: "Post Codex execution progress, test results, diff summaries, or blockers for a task.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        actor: { type: "string", enum: actorEnum },
        status: { type: "string", enum: executionStatusEnum },
        summary: { type: "string" },
        details: { type: "string" }
      },
      required: ["taskId", "summary"],
      additionalProperties: false
    }
  },
  {
    name: "hub_get_task_briefing",
    description: "Get a compact briefing for one collaboration task, including context, plans, execution results, and snapshots.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" }
      },
      required: ["taskId"],
      additionalProperties: false
    }
  },
  {
    name: "hub_snapshot_workspace",
    description: "Capture a lightweight workspace snapshot with file list, branch, and git status.",
    inputSchema: {
      type: "object",
      properties: {
        actor: { type: "string", enum: actorEnum },
        note: { type: "string" },
        maxFiles: { type: "number", description: "Maximum number of files to include." }
      },
      additionalProperties: false
    }
  },
  {
    name: "hub_search_workspace",
    description: "Search the configured workspace with ripgrep and return compact line matches.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        maxResults: { type: "number" }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    name: "hub_read_file",
    description: "Read a bounded text slice from a file inside the configured workspace.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative or absolute path inside the workspace." },
        startLine: { type: "number" },
        maxLines: { type: "number" }
      },
      required: ["path"],
      additionalProperties: false
    }
  },
  {
    name: "hub_overview",
    description: "Return a high-level overview of hub state.",
    inputSchema: {
      type: "object",
      properties: {
        includeStatePath: {
          type: "boolean",
          description: "Reserved for future use."
        }
      },
      additionalProperties: false
    }
  }
];

export const hubHandlers: Record<string, (args: unknown) => Promise<CallToolResult>> = {
  hub_create_task: async (args) =>
    jsonResult(
      await createTask({
        title: readString(args, "title"),
        description: readOptionalString(args, "description"),
        createdBy: readEnum(args, "createdBy", actorEnum) as HubActor | undefined,
        tags: readStringArray(args, "tags")
      })
    ),

  hub_list_tasks: async (args) =>
    jsonResult(
      await listTasks({
        status: readEnum(args, "status", taskStatusEnum) as HubTaskStatus | undefined,
        limit: readNumber(args, "limit")
      })
    ),

  hub_update_task_status: async (args) =>
    jsonResult(
      await updateTaskStatus({
        taskId: readString(args, "taskId"),
        status: readEnum(args, "status", taskStatusEnum, true) as HubTaskStatus
      })
    ),

  hub_append_context: async (args) =>
    jsonResult(
      await appendContext({
        taskId: readOptionalString(args, "taskId"),
        kind: readEnum(args, "kind", contextKindEnum) as HubContextKind | undefined,
        actor: readEnum(args, "actor", actorEnum) as HubActor | undefined,
        text: readString(args, "text"),
        source: readOptionalString(args, "source")
      })
    ),

  hub_post_plan: async (args) =>
    jsonResult(
      await postPlan({
        taskId: readString(args, "taskId"),
        actor: readEnum(args, "actor", actorEnum) as HubActor | undefined,
        title: readOptionalString(args, "title"),
        plan: readString(args, "plan"),
        status: readEnum(args, "status", planStatusEnum) as HubPlanStatus | undefined
      })
    ),

  hub_post_execution_result: async (args) =>
    jsonResult(
      await postExecutionResult({
        taskId: readString(args, "taskId"),
        actor: readEnum(args, "actor", actorEnum) as HubActor | undefined,
        status: readEnum(args, "status", executionStatusEnum) as HubExecutionStatus | undefined,
        summary: readString(args, "summary"),
        details: readOptionalString(args, "details")
      })
    ),

  hub_get_task_briefing: async (args) => jsonResult(await getTaskBriefing(readString(args, "taskId"))),

  hub_snapshot_workspace: async (args) => {
    const snapshot = await collectWorkspaceSnapshot(readNumber(args, "maxFiles") ?? 500);

    return jsonResult(
      await addWorkspaceSnapshot({
        ...snapshot,
        actor: readEnum(args, "actor", actorEnum) as HubActor | undefined,
        note: readOptionalString(args, "note")
      })
    );
  },

  hub_search_workspace: async (args) =>
    jsonResult(
      await searchWorkspace({
        query: readString(args, "query"),
        maxResults: readNumber(args, "maxResults")
      })
    ),

  hub_read_file: async (args) =>
    jsonResult(
      await readWorkspaceFile({
        path: readString(args, "path"),
        startLine: readNumber(args, "startLine"),
        maxLines: readNumber(args, "maxLines")
      })
    ),

  hub_overview: async (args) => {
    readBoolean(args, "includeStatePath");
    return jsonResult(await getHubOverview());
  }
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

function readEnum(args: unknown, key: string, allowed: string[], required = false) {
  const value = readOptionalString(args, key);

  if (!value) {
    if (required) {
      throw new Error(`Missing required string field: ${key}`);
    }

    return undefined;
  }

  if (!allowed.includes(value)) {
    throw new Error(`Invalid ${key}: ${value}. Expected one of: ${allowed.join(", ")}`);
  }

  return value;
}
