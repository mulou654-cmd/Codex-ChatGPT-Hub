import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

import {
  cleanupRuns,
  getRunOverview,
  grepRuns,
  listRunFiles,
  listRuns,
  readRunDiff,
  readRunFile,
  readRunLog,
  readRunManifest,
  readRunMeta,
  rebuildRunIndex,
  upsertRunArtifact,
  writeRunManifest,
  type RunArtifactKind,
  type RunLogKind
} from "../run/store.js";
import { readBoolean, readNumber, readOptionalString, readString, readStringArray } from "../utils/input.js";

const runLogKindEnum = ["stdout", "stderr"];
const grepKindEnum = ["stdout", "stderr", "diff", "all"];
const artifactKindEnum = ["metrics", "figure", "report", "table", "config", "checkpoint", "dataset", "log", "other"];

export const runTools: Tool[] = [
  {
    name: "run_overview",
    description: "Read run archive overview, indexed counts, disk usage, exit-code distribution, and artifact-kind counts.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "run_list",
    description: "List recent automatic run-wrapper archives.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number" }
      },
      additionalProperties: false
    }
  },
  {
    name: "run_get_meta",
    description: "Read run-wrapper metadata for one run id.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" }
      },
      required: ["runId"],
      additionalProperties: false
    }
  },
  {
    name: "run_read_log",
    description: "Read a bounded slice of stdout.log or stderr.log from a run archive.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" },
        kind: { type: "string", enum: runLogKindEnum },
        startLine: { type: "number" },
        maxLines: { type: "number" }
      },
      required: ["runId", "kind"],
      additionalProperties: false
    }
  },
  {
    name: "run_read_diff",
    description: "Read a bounded slice of diff.patch from a run archive.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" },
        startLine: { type: "number" },
        maxLines: { type: "number" }
      },
      required: ["runId"],
      additionalProperties: false
    }
  },
  {
    name: "run_list_files",
    description: "List files inside one run archive, including artifacts, with text-readability hints.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" }
      },
      required: ["runId"],
      additionalProperties: false
    }
  },
  {
    name: "run_get_manifest",
    description: "Read or generate manifest.json for one run archive. The manifest labels artifacts as metrics, figure, report, table, config, checkpoint, dataset, log, or other.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" },
        regenerate: { type: "boolean" }
      },
      required: ["runId"],
      additionalProperties: false
    }
  },
  {
    name: "run_tag_artifact",
    description: "Create or update one run artifact manifest entry with kind, label, description, and tags.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" },
        path: { type: "string" },
        kind: { type: "string", enum: artifactKindEnum },
        label: { type: "string" },
        description: { type: "string" },
        tags: { type: "array", items: { type: "string" } }
      },
      required: ["runId", "path", "kind"],
      additionalProperties: false
    }
  },
  {
    name: "run_read_file",
    description: "Read a bounded slice of a text file inside one run archive, including artifacts/*.json, *.md, *.csv, *.jsonl, logs, and patches.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" },
        path: { type: "string" },
        startLine: { type: "number" },
        maxLines: { type: "number" }
      },
      required: ["runId", "path"],
      additionalProperties: false
    }
  },
  {
    name: "run_grep",
    description: "Line-oriented grep over stdout, stderr, diff, and meta files in one or all run archives.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" },
        query: { type: "string" },
        kind: { type: "string", enum: grepKindEnum },
        caseSensitive: { type: "boolean" },
        maxResults: { type: "number" },
        contextLines: { type: "number" }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    name: "run_rebuild_index",
    description: "Rebuild .data/runs/index.json for faster long-running run archive listing and dashboard summaries.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "run_cleanup",
    description: "Preview or delete old run archives. Defaults to dryRun=true. Actual deletion requires confirm=\"DELETE_RUN_ARCHIVES\".",
    inputSchema: {
      type: "object",
      properties: {
        maxAgeDays: { type: "number" },
        keepLast: { type: "number" },
        includeFailed: { type: "boolean" },
        dryRun: { type: "boolean" },
        confirm: { type: "string" }
      },
      additionalProperties: false
    }
  }
];

export const runHandlers: Record<string, (args: unknown) => Promise<CallToolResult>> = {
  run_overview: async () => jsonResult(await getRunOverview()),

  run_list: async (args) => jsonResult(await listRuns(readNumber(args, "limit"))),

  run_get_meta: async (args) => jsonResult(await readRunMeta(readString(args, "runId"))),

  run_read_log: async (args) =>
    jsonResult(
      await readRunLog({
        runId: readString(args, "runId"),
        kind: readEnum(args, "kind", runLogKindEnum, true) as RunLogKind,
        startLine: readNumber(args, "startLine"),
        maxLines: readNumber(args, "maxLines")
      })
    ),

  run_read_diff: async (args) =>
    jsonResult(
      await readRunDiff({
        runId: readString(args, "runId"),
        startLine: readNumber(args, "startLine"),
        maxLines: readNumber(args, "maxLines")
      })
    ),

  run_list_files: async (args) => jsonResult(await listRunFiles(readString(args, "runId"))),

  run_get_manifest: async (args) => {
    const runId = readString(args, "runId");
    const regenerate = readBoolean(args, "regenerate") === true;
    return jsonResult(regenerate ? await writeRunManifest(runId) : await readRunManifest(runId).catch(() => writeRunManifest(runId)));
  },

  run_tag_artifact: async (args) =>
    jsonResult(
      await upsertRunArtifact({
        runId: readString(args, "runId"),
        path: readString(args, "path"),
        kind: readEnum(args, "kind", artifactKindEnum, true) as RunArtifactKind,
        label: readOptionalString(args, "label"),
        description: readOptionalString(args, "description"),
        tags: readStringArray(args, "tags")
      })
    ),

  run_read_file: async (args) =>
    jsonResult(
      await readRunFile({
        runId: readString(args, "runId"),
        path: readString(args, "path"),
        startLine: readNumber(args, "startLine"),
        maxLines: readNumber(args, "maxLines")
      })
    ),

  run_grep: async (args) =>
    jsonResult(
      await grepRuns({
        runId: readOptionalString(args, "runId"),
        query: readString(args, "query"),
        kind: readEnum(args, "kind", grepKindEnum) as "stdout" | "stderr" | "diff" | "all" | undefined,
        caseSensitive: readBoolean(args, "caseSensitive"),
        maxResults: readNumber(args, "maxResults"),
        contextLines: readNumber(args, "contextLines")
      })
    ),

  run_rebuild_index: async () => jsonResult(await rebuildRunIndex()),

  run_cleanup: async (args) =>
    jsonResult(
      await cleanupRuns({
        maxAgeDays: readNumber(args, "maxAgeDays"),
        keepLast: readNumber(args, "keepLast"),
        includeFailed: readBoolean(args, "includeFailed"),
        dryRun: readBoolean(args, "dryRun"),
        confirm: readOptionalString(args, "confirm")
      })
    )
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
