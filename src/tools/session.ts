import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

import type { HubActor } from "../hub/types.js";
import {
  addCommandEvent,
  appendSessionEvent,
  createSession,
  getSessionHandoff,
  getSessionOverview,
  grepSessionEvents,
  listSessions,
  readSessionEvent,
  searchSessions,
  updateSessionStatus,
  upsertSessionHandoff
} from "../session/store.js";
import type { SessionEventKind, SessionStatus } from "../session/types.js";
import {
  readBoolean,
  readNumber,
  readObject,
  readOptionalString,
  readString,
  readStringArray
} from "../utils/input.js";

const actorEnum = ["codex", "chatgpt", "user", "system"];
const sessionStatusEnum = ["active", "paused", "completed", "blocked", "archived"];
const eventKindEnum = [
  "user_request",
  "assistant_update",
  "decision",
  "command",
  "file_read",
  "file_write",
  "diff",
  "artifact",
  "test_result",
  "error",
  "handoff",
  "note"
];

export const sessionTools: Tool[] = [
  {
    name: "session_create",
    description: "Create a Codex session mirror for sharing execution context with ChatGPT.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        objective: { type: "string" },
        taskId: { type: "string" },
        projectId: { type: "string" },
        workspaceRoot: { type: "string" },
        createdBy: { type: "string", enum: actorEnum },
        tags: { type: "array", items: { type: "string" } }
      },
      required: ["title"],
      additionalProperties: false
    }
  },
  {
    name: "session_list",
    description: "List recent Codex session mirrors.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: sessionStatusEnum },
        limit: { type: "number" }
      },
      additionalProperties: false
    }
  },
  {
    name: "session_update_status",
    description: "Update a session mirror status.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        status: { type: "string", enum: sessionStatusEnum }
      },
      required: ["sessionId", "status"],
      additionalProperties: false
    }
  },
  {
    name: "session_append_event",
    description: "Append a compact event to a Codex session mirror: request, update, decision, file, diff, artifact, error, or note.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        kind: { type: "string", enum: eventKindEnum },
        actor: { type: "string", enum: actorEnum },
        text: { type: "string" },
        source: { type: "string" },
        summary: { type: "string" },
        command: { type: "string" },
        status: { type: "string" },
        exitCode: { type: "number" },
        durationMs: { type: "number" },
        path: { type: "string" },
        artifactPath: { type: "string" },
        metadata: { type: "object", additionalProperties: true }
      },
      required: ["sessionId", "text"],
      additionalProperties: false
    }
  },
  {
    name: "session_add_command",
    description: "Append a command execution summary, optional stdout/stderr tails, exit code, and timing to a session mirror.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        command: { type: "string" },
        summary: { type: "string" },
        status: { type: "string" },
        exitCode: { type: "number" },
        durationMs: { type: "number" },
        stdoutTail: { type: "string" },
        stderrTail: { type: "string" },
        actor: { type: "string", enum: actorEnum },
        metadata: { type: "object", additionalProperties: true }
      },
      required: ["sessionId", "command"],
      additionalProperties: false
    }
  },
  {
    name: "session_upsert_handoff",
    description: "Create or update the compact handoff package ChatGPT should read when taking over a Codex session.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        actor: { type: "string", enum: actorEnum },
        summary: { type: "string" },
        currentState: { type: "string" },
        nextSteps: { type: "array", items: { type: "string" } },
        blockers: { type: "array", items: { type: "string" } },
        importantFiles: { type: "array", items: { type: "string" } },
        openQuestions: { type: "array", items: { type: "string" } }
      },
      required: ["sessionId", "summary"],
      additionalProperties: false
    }
  },
  {
    name: "session_get_handoff",
    description: "Read a session handoff package plus recent events and counts.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" }
      },
      required: ["sessionId"],
      additionalProperties: false
    }
  },
  {
    name: "session_search",
    description: "Search session mirrors, events, command summaries, handoffs, artifacts, and errors.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        sessionId: { type: "string" },
        limit: { type: "number" }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    name: "session_grep",
    description: "Line-oriented grep over session events, command summaries, stdout/stderr tails, paths, artifacts, and metadata.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        sessionId: { type: "string" },
        kind: { type: "string", enum: eventKindEnum },
        caseSensitive: { type: "boolean" },
        maxResults: { type: "number" },
        contextLines: { type: "number" }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    name: "session_read_event",
    description: "Read one full session event by event id after session_grep/session_search returns a hit.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" }
      },
      required: ["eventId"],
      additionalProperties: false
    }
  },
  {
    name: "session_overview",
    description: "Return high-level counts and recent Codex session mirrors.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  }
];

export const sessionHandlers: Record<string, (args: unknown) => Promise<CallToolResult>> = {
  session_create: async (args) =>
    jsonResult(
      await createSession({
        title: readString(args, "title"),
        objective: readOptionalString(args, "objective"),
        taskId: readOptionalString(args, "taskId"),
        projectId: readOptionalString(args, "projectId"),
        workspaceRoot: readOptionalString(args, "workspaceRoot"),
        createdBy: readEnum(args, "createdBy", actorEnum) as HubActor | undefined,
        tags: readStringArray(args, "tags")
      })
    ),

  session_list: async (args) =>
    jsonResult(
      await listSessions(readEnum(args, "status", sessionStatusEnum) as SessionStatus | undefined, readNumber(args, "limit"))
    ),

  session_update_status: async (args) =>
    jsonResult(
      await updateSessionStatus({
        sessionId: readString(args, "sessionId"),
        status: readEnum(args, "status", sessionStatusEnum, true) as SessionStatus
      })
    ),

  session_append_event: async (args) =>
    jsonResult(
      await appendSessionEvent({
        sessionId: readString(args, "sessionId"),
        kind: readEnum(args, "kind", eventKindEnum) as SessionEventKind | undefined,
        actor: readEnum(args, "actor", actorEnum) as HubActor | undefined,
        text: readString(args, "text"),
        source: readOptionalString(args, "source"),
        summary: readOptionalString(args, "summary"),
        command: readOptionalString(args, "command"),
        status: readOptionalString(args, "status"),
        exitCode: readNumber(args, "exitCode"),
        durationMs: readNumber(args, "durationMs"),
        path: readOptionalString(args, "path"),
        artifactPath: readOptionalString(args, "artifactPath"),
        metadata: readObject(args, "metadata")
      })
    ),

  session_add_command: async (args) =>
    jsonResult(
      await addCommandEvent({
        sessionId: readString(args, "sessionId"),
        command: readString(args, "command"),
        summary: readOptionalString(args, "summary"),
        status: readOptionalString(args, "status"),
        exitCode: readNumber(args, "exitCode"),
        durationMs: readNumber(args, "durationMs"),
        stdoutTail: readOptionalString(args, "stdoutTail"),
        stderrTail: readOptionalString(args, "stderrTail"),
        actor: readEnum(args, "actor", actorEnum) as HubActor | undefined,
        metadata: readObject(args, "metadata")
      })
    ),

  session_upsert_handoff: async (args) =>
    jsonResult(
      await upsertSessionHandoff({
        sessionId: readString(args, "sessionId"),
        actor: readEnum(args, "actor", actorEnum) as HubActor | undefined,
        summary: readString(args, "summary"),
        currentState: readOptionalString(args, "currentState"),
        nextSteps: readStringArray(args, "nextSteps"),
        blockers: readStringArray(args, "blockers"),
        importantFiles: readStringArray(args, "importantFiles"),
        openQuestions: readStringArray(args, "openQuestions")
      })
    ),

  session_get_handoff: async (args) => jsonResult(await getSessionHandoff(readString(args, "sessionId"))),

  session_search: async (args) =>
    jsonResult(await searchSessions(readString(args, "query"), readOptionalString(args, "sessionId"), readNumber(args, "limit"))),

  session_grep: async (args) =>
    jsonResult(
      await grepSessionEvents({
        query: readString(args, "query"),
        sessionId: readOptionalString(args, "sessionId"),
        kind: readEnum(args, "kind", eventKindEnum) as SessionEventKind | undefined,
        caseSensitive: readBoolean(args, "caseSensitive"),
        maxResults: readNumber(args, "maxResults"),
        contextLines: readNumber(args, "contextLines")
      })
    ),

  session_read_event: async (args) => jsonResult(await readSessionEvent(readString(args, "eventId"))),

  session_overview: async () => jsonResult(await getSessionOverview())
};

function readEnum(args: unknown, key: string, values: string[], required = false) {
  const value = readOptionalString(args, key);

  if (!value) {
    if (required) {
      throw new Error(`Missing required enum field: ${key}`);
    }

    return undefined;
  }

  if (!values.includes(value)) {
    throw new Error(`Invalid ${key}: ${value}. Expected one of: ${values.join(", ")}`);
  }

  return value;
}

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
