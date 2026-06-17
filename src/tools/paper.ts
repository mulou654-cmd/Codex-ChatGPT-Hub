import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

import type { HubActor } from "../hub/types.js";
import {
  addPaperClaim,
  addPaperEvidence,
  addPaperExperiment,
  addPaperFigure,
  addPaperFramework,
  addPaperInsight,
  addLiteratureReview,
  addPaperNote,
  addPaperSource,
  createPaperProject,
  getPaperBriefing,
  getPaperOverview,
  grepLiteratureReview,
  importLiteratureReview,
  listPaperProjects,
  readLiteratureReview,
  searchPaperMemory,
  updatePaperProjectStatus,
  upsertPaperOutline,
  writePaperSection
} from "../paper/store.js";
import type {
  PaperClaimStatus,
  PaperEvidenceType,
  PaperExperimentStatus,
  PaperInsightKind,
  PaperInsightStatus,
  LiteratureReviewKind,
  PaperEvidenceSeed,
  PaperNote,
  PaperProjectStatus,
  PaperRelatedWorkAnchor,
  PaperSectionStatus,
  PaperSourceType
} from "../paper/types.js";
import { readBoolean, readNumber, readObject, readOptionalString, readString, readStringArray } from "../utils/input.js";

const actorEnum = ["codex", "chatgpt", "user", "system"];
const projectStatusEnum = ["active", "paused", "submitted", "published", "archived"];
const sourceTypeEnum = ["paper", "book", "dataset", "website", "code", "note"];
const claimStatusEnum = ["hypothesis", "supported", "contested", "rejected", "needs_evidence"];
const evidenceTypeEnum = ["source", "experiment", "figure", "code", "dataset", "note"];
const experimentStatusEnum = ["planned", "running", "completed", "failed", "abandoned"];
const sectionStatusEnum = ["todo", "draft", "reviewed", "final"];
const noteKindEnum = ["research", "writing", "decision", "todo", "log"];
const literatureReviewKindEnum = ["survey", "summary", "related_work", "reading_notes"];
const insightKindEnum = ["innovation", "feasibility", "risk", "experiment_idea", "positioning", "critique"];
const insightStatusEnum = ["proposed", "accepted", "rejected", "needs_evidence", "needs_experiment"];

const evidenceSeedSchema = {
  type: "object",
  properties: {
    type: { type: "string", enum: evidenceTypeEnum },
    summary: { type: "string" },
    source: { type: "string", description: "File path, paper ID, experiment ID, dataset, URL, or note source." },
    locator: { type: "string", description: "Page, table, figure, line range, run ID, or other exact locator." },
    quote: { type: "string" },
    data: { type: "object", additionalProperties: true },
    createdBy: { type: "string", enum: actorEnum }
  },
  required: ["summary"],
  additionalProperties: false
};

const relatedWorkAnchorSchema = {
  type: "object",
  properties: {
    sourceId: { type: "string" },
    reviewId: { type: "string" },
    citationKey: { type: "string" },
    source: { type: "string", description: "Fallback source name, URL, file, or related-work note." },
    locator: { type: "string", description: "Section, page, line range, paragraph, or other exact locator." },
    summary: { type: "string" }
  },
  required: ["summary"],
  additionalProperties: false
};

export const paperTools: Tool[] = [
  {
    name: "paper_create_project",
    description: "Create a V2 research paper workspace with a research question and writing target.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        researchQuestion: { type: "string" },
        createdBy: { type: "string", enum: actorEnum },
        venue: { type: "string" },
        deadline: { type: "string" },
        keywords: { type: "array", items: { type: "string" } },
        notes: { type: "string" }
      },
      required: ["title", "researchQuestion"],
      additionalProperties: false
    }
  },
  {
    name: "paper_list_projects",
    description: "List V2 research paper workspaces.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: projectStatusEnum },
        limit: { type: "number" }
      },
      additionalProperties: false
    }
  },
  {
    name: "paper_update_project_status",
    description: "Update a research paper workspace status.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        status: { type: "string", enum: projectStatusEnum }
      },
      required: ["projectId", "status"],
      additionalProperties: false
    }
  },
  {
    name: "paper_add_note",
    description: "Add a research, writing, decision, todo, or log note to a paper workspace.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        actor: { type: "string", enum: actorEnum },
        kind: { type: "string", enum: noteKindEnum },
        text: { type: "string" },
        source: { type: "string" }
      },
      required: ["projectId", "text"],
      additionalProperties: false
    }
  },
  {
    name: "paper_import_literature_review",
    description: "Import a full Codex-generated literature review markdown file into shared paper memory.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        sourcePath: { type: "string", description: "Absolute path or allowed workspace-relative path to a markdown review." },
        title: { type: "string" },
        kind: { type: "string", enum: literatureReviewKindEnum },
        importedBy: { type: "string", enum: actorEnum },
        summary: { type: "string" },
        tags: { type: "array", items: { type: "string" } }
      },
      required: ["projectId", "sourcePath"],
      additionalProperties: false
    }
  },
  {
    name: "paper_add_literature_review",
    description: "Add a full literature review artifact from text content into shared paper memory.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        title: { type: "string" },
        kind: { type: "string", enum: literatureReviewKindEnum },
        content: { type: "string" },
        sourcePath: { type: "string" },
        importedBy: { type: "string", enum: actorEnum },
        summary: { type: "string" },
        tags: { type: "array", items: { type: "string" } }
      },
      required: ["projectId", "title", "content"],
      additionalProperties: false
    }
  },
  {
    name: "paper_read_literature_review",
    description: "Read a bounded slice of a full literature review artifact, with section index metadata.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        reviewId: { type: "string" },
        startLine: { type: "number" },
        maxLines: { type: "number" }
      },
      required: ["projectId", "reviewId"],
      additionalProperties: false
    }
  },
  {
    name: "paper_grep_literature_review",
    description: "Line-oriented grep over one or all imported literature review artifacts in a paper project.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        reviewId: { type: "string" },
        query: { type: "string" },
        caseSensitive: { type: "boolean" },
        maxResults: { type: "number" },
        contextLines: { type: "number" }
      },
      required: ["projectId", "query"],
      additionalProperties: false
    }
  },
  {
    name: "paper_add_insight",
    description: "Record ChatGPT-generated innovation ideas, feasibility analysis, risks, positioning, or experiment ideas from literature review thinking.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        kind: { type: "string", enum: insightKindEnum },
        title: { type: "string" },
        text: { type: "string" },
        status: { type: "string", enum: insightStatusEnum },
        createdBy: { type: "string", enum: actorEnum },
        reviewIds: { type: "array", items: { type: "string" } },
        claimIds: { type: "array", items: { type: "string" } },
        evidenceIds: { type: "array", items: { type: "string" } },
        experimentIds: { type: "array", items: { type: "string" } },
        tags: { type: "array", items: { type: "string" } }
      },
      required: ["projectId", "title", "text"],
      additionalProperties: false
    }
  },
  {
    name: "paper_add_source",
    description: "Add a literature source, dataset, code reference, website, or note to a paper workspace.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        type: { type: "string", enum: sourceTypeEnum },
        title: { type: "string" },
        authors: { type: "array", items: { type: "string" } },
        year: { type: "number" },
        venue: { type: "string" },
        url: { type: "string" },
        filePath: { type: "string" },
        citationKey: { type: "string" },
        summary: { type: "string" },
        contributions: { type: "array", items: { type: "string" } },
        limitations: { type: "array", items: { type: "string" } },
        tags: { type: "array", items: { type: "string" } }
      },
      required: ["projectId", "title"],
      additionalProperties: false
    }
  },
  {
    name: "paper_add_claim",
    description: "Add a paper claim or hypothesis. Every claim must include initial evidence so ChatGPT can inspect the support immediately.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        text: { type: "string" },
        section: { type: "string" },
        status: { type: "string", enum: claimStatusEnum },
        priority: { type: "number", description: "1 high, 5 low." },
        sourceIds: { type: "array", items: { type: "string" } },
        evidence: evidenceSeedSchema,
        createdBy: { type: "string", enum: actorEnum }
      },
      required: ["projectId", "text", "evidence"],
      additionalProperties: false
    }
  },
  {
    name: "paper_add_evidence",
    description: "Attach evidence to a paper project or specific claim, with source locator and optional data.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        claimId: { type: "string" },
        type: { type: "string", enum: evidenceTypeEnum },
        summary: { type: "string" },
        source: { type: "string", description: "File path, paper ID, experiment ID, dataset, URL, or note source." },
        locator: { type: "string", description: "Page, table, figure, line range, run ID, or other exact locator." },
        quote: { type: "string" },
        data: { type: "object", additionalProperties: true },
        createdBy: { type: "string", enum: actorEnum }
      },
      required: ["projectId", "summary"],
      additionalProperties: false
    }
  },
  {
    name: "paper_add_framework",
    description: "Add a named paper framework. Every framework must include a justification explaining why this structure is appropriate.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        components: { type: "array", items: { type: "string" } },
        justification: { type: "string" },
        claimIds: { type: "array", items: { type: "string" } },
        evidenceIds: { type: "array", items: { type: "string" } },
        sourceIds: { type: "array", items: { type: "string" } },
        createdBy: { type: "string", enum: actorEnum }
      },
      required: ["projectId", "name", "justification"],
      additionalProperties: false
    }
  },
  {
    name: "paper_add_experiment",
    description: "Record an experiment design or result for paper writing and evidence tracking.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        title: { type: "string" },
        hypothesis: { type: "string" },
        status: { type: "string", enum: experimentStatusEnum },
        command: { type: "string" },
        codeRef: { type: "string" },
        dataset: { type: "string" },
        metrics: { type: "object", additionalProperties: true },
        resultSummary: { type: "string" },
        artifactPaths: { type: "array", items: { type: "string" } },
        createdBy: { type: "string", enum: actorEnum }
      },
      required: ["projectId", "title"],
      additionalProperties: false
    }
  },
  {
    name: "paper_add_figure",
    description: "Register a figure artifact, caption, and its linked claims or experiments.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        title: { type: "string" },
        path: { type: "string" },
        caption: { type: "string" },
        claimIds: { type: "array", items: { type: "string" } },
        experimentIds: { type: "array", items: { type: "string" } },
        createdBy: { type: "string", enum: actorEnum }
      },
      required: ["projectId", "title", "path"],
      additionalProperties: false
    }
  },
  {
    name: "paper_upsert_outline",
    description: "Create or update a paper outline section linked to claims and evidence. Every outline section must include a related-work anchor.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        name: { type: "string" },
        goal: { type: "string" },
        bullets: { type: "array", items: { type: "string" } },
        claimIds: { type: "array", items: { type: "string" } },
        evidenceIds: { type: "array", items: { type: "string" } },
        relatedWorkAnchor: relatedWorkAnchorSchema,
        status: { type: "string", enum: sectionStatusEnum },
        order: { type: "number" }
      },
      required: ["projectId", "name", "relatedWorkAnchor"],
      additionalProperties: false
    }
  },
  {
    name: "paper_write_section",
    description: "Store a paper section draft written by ChatGPT, Codex, or the user. Every section draft must include a related-work anchor.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        sectionName: { type: "string" },
        content: { type: "string" },
        relatedWorkAnchor: relatedWorkAnchorSchema,
        status: { type: "string", enum: sectionStatusEnum },
        author: { type: "string", enum: actorEnum }
      },
      required: ["projectId", "sectionName", "content", "relatedWorkAnchor"],
      additionalProperties: false
    }
  },
  {
    name: "paper_get_briefing",
    description: "Get the shared research memory needed for planning, execution, and paper writing.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" }
      },
      required: ["projectId"],
      additionalProperties: false
    }
  },
  {
    name: "paper_search_memory",
    description: "Search V2 research memory across projects, sources, claims, evidence, experiments, figures, outlines, drafts, and notes.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        projectId: { type: "string" },
        limit: { type: "number" }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    name: "paper_overview",
    description: "Return counts and recent V2 paper workspaces.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  }
];

export const paperHandlers: Record<string, (args: unknown) => Promise<CallToolResult>> = {
  paper_create_project: async (args) =>
    jsonResult(
      await createPaperProject({
        title: readString(args, "title"),
        researchQuestion: readString(args, "researchQuestion"),
        createdBy: readEnum(args, "createdBy", actorEnum) as HubActor | undefined,
        venue: readOptionalString(args, "venue"),
        deadline: readOptionalString(args, "deadline"),
        keywords: readStringArray(args, "keywords"),
        notes: readOptionalString(args, "notes")
      })
    ),

  paper_list_projects: async (args) =>
    jsonResult(
      await listPaperProjects(
        readEnum(args, "status", projectStatusEnum) as PaperProjectStatus | undefined,
        readNumber(args, "limit")
      )
    ),

  paper_update_project_status: async (args) =>
    jsonResult(
      await updatePaperProjectStatus({
        projectId: readString(args, "projectId"),
        status: readEnum(args, "status", projectStatusEnum, true) as PaperProjectStatus
      })
    ),

  paper_add_note: async (args) =>
    jsonResult(
      await addPaperNote({
        projectId: readString(args, "projectId"),
        actor: readEnum(args, "actor", actorEnum) as HubActor | undefined,
        kind: readEnum(args, "kind", noteKindEnum) as PaperNote["kind"] | undefined,
        text: readString(args, "text"),
        source: readOptionalString(args, "source")
      })
    ),

  paper_import_literature_review: async (args) =>
    jsonResult(
      await importLiteratureReview({
        projectId: readString(args, "projectId"),
        sourcePath: readString(args, "sourcePath"),
        title: readOptionalString(args, "title"),
        kind: readEnum(args, "kind", literatureReviewKindEnum) as LiteratureReviewKind | undefined,
        importedBy: readEnum(args, "importedBy", actorEnum) as HubActor | undefined,
        summary: readOptionalString(args, "summary"),
        tags: readStringArray(args, "tags")
      })
    ),

  paper_add_literature_review: async (args) =>
    jsonResult(
      await addLiteratureReview({
        projectId: readString(args, "projectId"),
        title: readString(args, "title"),
        kind: readEnum(args, "kind", literatureReviewKindEnum) as LiteratureReviewKind | undefined,
        content: readString(args, "content"),
        sourcePath: readOptionalString(args, "sourcePath"),
        importedBy: readEnum(args, "importedBy", actorEnum) as HubActor | undefined,
        summary: readOptionalString(args, "summary"),
        tags: readStringArray(args, "tags")
      })
    ),

  paper_read_literature_review: async (args) =>
    jsonResult(
      await readLiteratureReview({
        projectId: readString(args, "projectId"),
        reviewId: readString(args, "reviewId"),
        startLine: readNumber(args, "startLine"),
        maxLines: readNumber(args, "maxLines")
      })
    ),

  paper_grep_literature_review: async (args) =>
    jsonResult(
      await grepLiteratureReview({
        projectId: readString(args, "projectId"),
        reviewId: readOptionalString(args, "reviewId"),
        query: readString(args, "query"),
        caseSensitive: readBoolean(args, "caseSensitive"),
        maxResults: readNumber(args, "maxResults"),
        contextLines: readNumber(args, "contextLines")
      })
    ),

  paper_add_insight: async (args) =>
    jsonResult(
      await addPaperInsight({
        projectId: readString(args, "projectId"),
        kind: readEnum(args, "kind", insightKindEnum) as PaperInsightKind | undefined,
        title: readString(args, "title"),
        text: readString(args, "text"),
        status: readEnum(args, "status", insightStatusEnum) as PaperInsightStatus | undefined,
        createdBy: readEnum(args, "createdBy", actorEnum) as HubActor | undefined,
        reviewIds: readStringArray(args, "reviewIds"),
        claimIds: readStringArray(args, "claimIds"),
        evidenceIds: readStringArray(args, "evidenceIds"),
        experimentIds: readStringArray(args, "experimentIds"),
        tags: readStringArray(args, "tags")
      })
    ),

  paper_add_source: async (args) =>
    jsonResult(
      await addPaperSource({
        projectId: readString(args, "projectId"),
        type: readEnum(args, "type", sourceTypeEnum) as PaperSourceType | undefined,
        title: readString(args, "title"),
        authors: readStringArray(args, "authors"),
        year: readNumber(args, "year"),
        venue: readOptionalString(args, "venue"),
        url: readOptionalString(args, "url"),
        filePath: readOptionalString(args, "filePath"),
        citationKey: readOptionalString(args, "citationKey"),
        summary: readOptionalString(args, "summary"),
        contributions: readStringArray(args, "contributions"),
        limitations: readStringArray(args, "limitations"),
        tags: readStringArray(args, "tags")
      })
    ),

  paper_add_claim: async (args) =>
    jsonResult(
      await addPaperClaim({
        projectId: readString(args, "projectId"),
        text: readString(args, "text"),
        section: readOptionalString(args, "section"),
        status: readEnum(args, "status", claimStatusEnum) as PaperClaimStatus | undefined,
        priority: readNumber(args, "priority"),
        sourceIds: readStringArray(args, "sourceIds"),
        evidence: readEvidenceSeed(args, "evidence"),
        createdBy: readEnum(args, "createdBy", actorEnum) as HubActor | undefined
      })
    ),

  paper_add_evidence: async (args) =>
    jsonResult(
      await addPaperEvidence({
        projectId: readString(args, "projectId"),
        claimId: readOptionalString(args, "claimId"),
        type: readEnum(args, "type", evidenceTypeEnum) as PaperEvidenceType | undefined,
        summary: readString(args, "summary"),
        source: readOptionalString(args, "source"),
        locator: readOptionalString(args, "locator"),
        quote: readOptionalString(args, "quote"),
        data: readObject(args, "data"),
        createdBy: readEnum(args, "createdBy", actorEnum) as HubActor | undefined
      })
    ),

  paper_add_framework: async (args) =>
    jsonResult(
      await addPaperFramework({
        projectId: readString(args, "projectId"),
        name: readString(args, "name"),
        description: readOptionalString(args, "description"),
        components: readStringArray(args, "components"),
        justification: readString(args, "justification"),
        claimIds: readStringArray(args, "claimIds"),
        evidenceIds: readStringArray(args, "evidenceIds"),
        sourceIds: readStringArray(args, "sourceIds"),
        createdBy: readEnum(args, "createdBy", actorEnum) as HubActor | undefined
      })
    ),

  paper_add_experiment: async (args) =>
    jsonResult(
      await addPaperExperiment({
        projectId: readString(args, "projectId"),
        title: readString(args, "title"),
        hypothesis: readOptionalString(args, "hypothesis"),
        status: readEnum(args, "status", experimentStatusEnum) as PaperExperimentStatus | undefined,
        command: readOptionalString(args, "command"),
        codeRef: readOptionalString(args, "codeRef"),
        dataset: readOptionalString(args, "dataset"),
        metrics: readObject(args, "metrics"),
        resultSummary: readOptionalString(args, "resultSummary"),
        artifactPaths: readStringArray(args, "artifactPaths"),
        createdBy: readEnum(args, "createdBy", actorEnum) as HubActor | undefined
      })
    ),

  paper_add_figure: async (args) =>
    jsonResult(
      await addPaperFigure({
        projectId: readString(args, "projectId"),
        title: readString(args, "title"),
        path: readString(args, "path"),
        caption: readOptionalString(args, "caption"),
        claimIds: readStringArray(args, "claimIds"),
        experimentIds: readStringArray(args, "experimentIds"),
        createdBy: readEnum(args, "createdBy", actorEnum) as HubActor | undefined
      })
    ),

  paper_upsert_outline: async (args) =>
    jsonResult(
      await upsertPaperOutline({
        projectId: readString(args, "projectId"),
        name: readString(args, "name"),
        goal: readOptionalString(args, "goal"),
        bullets: readStringArray(args, "bullets"),
        claimIds: readStringArray(args, "claimIds"),
        evidenceIds: readStringArray(args, "evidenceIds"),
        relatedWorkAnchor: readRelatedWorkAnchor(args, "relatedWorkAnchor"),
        status: readEnum(args, "status", sectionStatusEnum) as PaperSectionStatus | undefined,
        order: readNumber(args, "order")
      })
    ),

  paper_write_section: async (args) =>
    jsonResult(
      await writePaperSection({
        projectId: readString(args, "projectId"),
        sectionName: readString(args, "sectionName"),
        content: readString(args, "content"),
        relatedWorkAnchor: readRelatedWorkAnchor(args, "relatedWorkAnchor"),
        status: readEnum(args, "status", sectionStatusEnum) as PaperSectionStatus | undefined,
        author: readEnum(args, "author", actorEnum) as HubActor | undefined
      })
    ),

  paper_get_briefing: async (args) => jsonResult(await getPaperBriefing(readString(args, "projectId"))),

  paper_search_memory: async (args) =>
    jsonResult(
      await searchPaperMemory(
        readString(args, "query"),
        readOptionalString(args, "projectId"),
        readNumber(args, "limit")
      )
    ),

  paper_overview: async () => jsonResult(await getPaperOverview())
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

function readRequiredObject(args: unknown, key: string): Record<string, unknown> {
  const value = readObject(args, key);

  if (!value) {
    throw new Error(`Missing required object field: ${key}`);
  }

  return value;
}

function readEvidenceSeed(args: unknown, key: string): PaperEvidenceSeed {
  const value = readRequiredObject(args, key);

  return {
    type: readEnum(value, "type", evidenceTypeEnum) as PaperEvidenceType | undefined,
    summary: readString(value, "summary"),
    source: readOptionalString(value, "source"),
    locator: readOptionalString(value, "locator"),
    quote: readOptionalString(value, "quote"),
    data: readObject(value, "data"),
    createdBy: readEnum(value, "createdBy", actorEnum) as HubActor | undefined
  };
}

function readRelatedWorkAnchor(args: unknown, key: string): PaperRelatedWorkAnchor {
  const value = readRequiredObject(args, key);

  return {
    sourceId: readOptionalString(value, "sourceId"),
    reviewId: readOptionalString(value, "reviewId"),
    citationKey: readOptionalString(value, "citationKey"),
    source: readOptionalString(value, "source"),
    locator: readOptionalString(value, "locator"),
    summary: readString(value, "summary")
  };
}
