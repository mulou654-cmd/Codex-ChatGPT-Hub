import { copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { dataDir, getRuntimeMemoryInfo, type RuntimeMemoryInfo, spaceDataDir, workspaceRoot } from "../hub/config.js";
import type { HubActor } from "../hub/types.js";
import { parseJson } from "../utils/json.js";
import { paperStatePath } from "./config.js";
import type {
  LiteratureReviewArtifact,
  LiteratureReviewKind,
  LiteratureReviewSection,
  PaperClaim,
  PaperClaimStatus,
  PaperEvidence,
  PaperEvidenceSeed,
  PaperEvidenceType,
  PaperExperiment,
  PaperExperimentStatus,
  PaperFigure,
  PaperFramework,
  PaperInsight,
  PaperInsightKind,
  PaperInsightStatus,
  PaperNote,
  PaperOutlineSection,
  PaperProject,
  PaperProjectStatus,
  PaperRelatedWorkAnchor,
  PaperSectionDraft,
  PaperSectionStatus,
  PaperSource,
  PaperSourceType,
  PaperState
} from "./types.js";

const maxBriefingItems = 30;

export interface CreatePaperProjectInput {
  title: string;
  researchQuestion: string;
  createdBy?: HubActor;
  venue?: string;
  deadline?: string;
  keywords?: string[];
  notes?: string;
}

export interface AddPaperNoteInput {
  projectId: string;
  actor?: HubActor;
  kind?: PaperNote["kind"];
  text: string;
  source?: string;
}

export interface ImportLiteratureReviewInput {
  projectId: string;
  title?: string;
  kind?: LiteratureReviewKind;
  sourcePath: string;
  importedBy?: HubActor;
  summary?: string;
  tags?: string[];
}

export interface AddLiteratureReviewInput {
  projectId: string;
  title: string;
  kind?: LiteratureReviewKind;
  content: string;
  sourcePath?: string;
  importedBy?: HubActor;
  summary?: string;
  tags?: string[];
}

export interface ReadLiteratureReviewInput {
  projectId: string;
  reviewId: string;
  startLine?: number;
  maxLines?: number;
}

export interface GrepLiteratureReviewInput {
  projectId: string;
  reviewId?: string;
  query: string;
  caseSensitive?: boolean;
  maxResults?: number;
  contextLines?: number;
}

export interface AddPaperInsightInput {
  projectId: string;
  kind?: PaperInsightKind;
  title: string;
  text: string;
  status?: PaperInsightStatus;
  createdBy?: HubActor;
  reviewIds?: string[];
  claimIds?: string[];
  evidenceIds?: string[];
  experimentIds?: string[];
  tags?: string[];
}

export interface AddPaperSourceInput {
  projectId: string;
  type?: PaperSourceType;
  title: string;
  authors?: string[];
  year?: number;
  venue?: string;
  url?: string;
  filePath?: string;
  citationKey?: string;
  summary?: string;
  contributions?: string[];
  limitations?: string[];
  tags?: string[];
}

export interface AddPaperClaimInput {
  projectId: string;
  text: string;
  section?: string;
  status?: PaperClaimStatus;
  priority?: number;
  sourceIds?: string[];
  evidence: PaperEvidenceSeed;
  createdBy?: HubActor;
}

export interface AddPaperEvidenceInput {
  projectId: string;
  claimId?: string;
  type?: PaperEvidenceType;
  summary: string;
  source?: string;
  locator?: string;
  quote?: string;
  data?: Record<string, unknown>;
  createdBy?: HubActor;
}

export interface AddPaperFrameworkInput {
  projectId: string;
  name: string;
  description?: string;
  components?: string[];
  justification: string;
  claimIds?: string[];
  evidenceIds?: string[];
  sourceIds?: string[];
  createdBy?: HubActor;
}

export interface AddPaperExperimentInput {
  projectId: string;
  title: string;
  hypothesis?: string;
  status?: PaperExperimentStatus;
  command?: string;
  codeRef?: string;
  dataset?: string;
  metrics?: Record<string, unknown>;
  resultSummary?: string;
  artifactPaths?: string[];
  createdBy?: HubActor;
}

export interface AddPaperFigureInput {
  projectId: string;
  title: string;
  path: string;
  caption?: string;
  claimIds?: string[];
  experimentIds?: string[];
  createdBy?: HubActor;
}

export interface UpsertPaperOutlineInput {
  projectId: string;
  name: string;
  goal?: string;
  bullets?: string[];
  claimIds?: string[];
  evidenceIds?: string[];
  relatedWorkAnchor: PaperRelatedWorkAnchor;
  status?: PaperSectionStatus;
  order?: number;
}

export interface WritePaperSectionInput {
  projectId: string;
  sectionName: string;
  content: string;
  relatedWorkAnchor: PaperRelatedWorkAnchor;
  status?: PaperSectionStatus;
  author?: HubActor;
}

export interface UpdatePaperProjectStatusInput {
  projectId: string;
  status: PaperProjectStatus;
}

export interface PaperProjectBriefing {
  runtime: RuntimeMemoryInfo;
  project: PaperProject;
  notes: PaperNote[];
  literatureReviews: Array<Omit<LiteratureReviewArtifact, "content"> & { contentPreview: string }>;
  insights: PaperInsight[];
  sources: PaperSource[];
  claims: PaperClaim[];
  evidence: PaperEvidence[];
  frameworks: PaperFramework[];
  experiments: PaperExperiment[];
  figures: PaperFigure[];
  outlineSections: PaperOutlineSection[];
  sectionDrafts: PaperSectionDraft[];
  writingReadiness: {
    supportedClaims: number;
    claimsNeedingEvidence: number;
    completedExperiments: number;
    draftSections: number;
    finalSections: number;
  };
}

export async function createPaperProject(input: CreatePaperProjectInput) {
  const state = await loadPaperState();
  const now = nowIso();
  const project: PaperProject = {
    id: createId("paper"),
    title: input.title,
    researchQuestion: input.researchQuestion,
    status: "active",
    createdBy: input.createdBy ?? "user",
    createdAt: now,
    updatedAt: now,
    venue: input.venue,
    deadline: input.deadline,
    keywords: input.keywords ?? [],
    notes: input.notes
  };

  state.projects.unshift(project);
  await savePaperState(state);
  return project;
}

export async function addPaperNote(input: AddPaperNoteInput) {
  const state = await loadPaperState();
  assertProjectExists(state, input.projectId);

  const note: PaperNote = {
    id: createId("note"),
    projectId: input.projectId,
    actor: input.actor ?? "user",
    kind: input.kind ?? "research",
    text: input.text,
    source: input.source,
    createdAt: nowIso()
  };

  state.notes.unshift(note);
  touchProject(state, input.projectId);
  await savePaperState(state);
  return note;
}

export async function importLiteratureReview(input: ImportLiteratureReviewInput) {
  const sourcePath = resolveReadablePath(input.sourcePath);
  const content = await readFile(sourcePath, "utf8");

  return addLiteratureReview({
    projectId: input.projectId,
    title: input.title ?? path.basename(sourcePath),
    kind: input.kind,
    content,
    sourcePath,
    importedBy: input.importedBy,
    summary: input.summary,
    tags: input.tags
  });
}

export async function addLiteratureReview(input: AddLiteratureReviewInput) {
  const state = await loadPaperState();
  assertProjectExists(state, input.projectId);
  const now = nowIso();
  const lines = splitLines(input.content);

  const review: LiteratureReviewArtifact = {
    id: createId("review"),
    projectId: input.projectId,
    title: input.title,
    kind: input.kind ?? "survey",
    sourcePath: input.sourcePath,
    importedBy: input.importedBy ?? "codex",
    createdAt: now,
    updatedAt: now,
    lineCount: lines.length,
    charCount: input.content.length,
    summary: input.summary,
    content: input.content,
    sections: extractMarkdownSections(lines),
    tags: input.tags ?? []
  };

  state.literatureReviews.unshift(review);
  touchProject(state, input.projectId);
  await savePaperState(state);
  return summarizeLiteratureReview(review);
}

export async function readLiteratureReview(input: ReadLiteratureReviewInput) {
  const state = await loadPaperState();
  const review = findLiteratureReview(state, input.projectId, input.reviewId);
  const lines = splitLines(review.content);
  const startLine = clampNumber(input.startLine, 1, 1, Math.max(lines.length, 1));
  const maxLines = clampNumber(input.maxLines, 120, 1, 1000);
  const selected = lines.slice(startLine - 1, startLine - 1 + maxLines);

  return {
    id: review.id,
    projectId: review.projectId,
    title: review.title,
    sourcePath: review.sourcePath,
    startLine,
    endLine: startLine + selected.length - 1,
    lineCount: review.lineCount,
    charCount: review.charCount,
    content: selected.join("\n"),
    sections: review.sections
  };
}

export async function grepLiteratureReview(input: GrepLiteratureReviewInput) {
  const state = await loadPaperState();
  const maxResults = clampNumber(input.maxResults, 50, 1, 200);
  const contextLines = clampNumber(input.contextLines, 0, 0, 5);
  const needle = input.caseSensitive ? input.query : input.query.toLowerCase();
  const reviews = input.reviewId
    ? [findLiteratureReview(state, input.projectId, input.reviewId)]
    : state.literatureReviews.filter((review) => review.projectId === input.projectId);
  const matches: Array<{
    reviewId: string;
    title: string;
    line: number;
    text: string;
    before: string[];
    after: string[];
    section?: string;
  }> = [];

  for (const review of reviews) {
    if (matches.length >= maxResults) {
      break;
    }

    const lines = splitLines(review.content);

    for (let index = 0; index < lines.length && matches.length < maxResults; index += 1) {
      const line = lines[index] ?? "";
      const comparable = input.caseSensitive ? line : line.toLowerCase();

      if (!comparable.includes(needle)) {
        continue;
      }

      matches.push({
        reviewId: review.id,
        title: review.title,
        line: index + 1,
        text: line,
        before: lines.slice(Math.max(0, index - contextLines), index),
        after: lines.slice(index + 1, index + 1 + contextLines),
        section: findSectionForLine(review.sections, index + 1)?.heading
      });
    }
  }

  return matches;
}

export async function addPaperInsight(input: AddPaperInsightInput) {
  const state = await loadPaperState();
  assertProjectExists(state, input.projectId);
  assertLiteratureReviewsExist(state, input.projectId, input.reviewIds ?? []);
  assertClaimsExist(state, input.projectId, input.claimIds ?? []);
  assertEvidenceExist(state, input.projectId, input.evidenceIds ?? []);
  assertExperimentsExist(state, input.projectId, input.experimentIds ?? []);
  const now = nowIso();

  const insight: PaperInsight = {
    id: createId("insight"),
    projectId: input.projectId,
    kind: input.kind ?? "innovation",
    title: input.title,
    text: input.text,
    status: input.status ?? "proposed",
    createdBy: input.createdBy ?? "chatgpt",
    createdAt: now,
    updatedAt: now,
    reviewIds: input.reviewIds ?? [],
    claimIds: input.claimIds ?? [],
    evidenceIds: input.evidenceIds ?? [],
    experimentIds: input.experimentIds ?? [],
    tags: input.tags ?? []
  };

  state.insights.unshift(insight);
  touchProject(state, input.projectId);
  await savePaperState(state);
  return insight;
}

export async function addPaperSource(input: AddPaperSourceInput) {
  const state = await loadPaperState();
  assertProjectExists(state, input.projectId);
  const now = nowIso();

  const source: PaperSource = {
    id: createId("src"),
    projectId: input.projectId,
    type: input.type ?? "paper",
    title: input.title,
    authors: input.authors ?? [],
    year: input.year,
    venue: input.venue,
    url: input.url,
    filePath: input.filePath,
    citationKey: input.citationKey,
    summary: input.summary,
    contributions: input.contributions ?? [],
    limitations: input.limitations ?? [],
    tags: input.tags ?? [],
    createdAt: now,
    updatedAt: now
  };

  state.sources.unshift(source);
  touchProject(state, input.projectId);
  await savePaperState(state);
  return source;
}

export async function addPaperClaim(input: AddPaperClaimInput) {
  const state = await loadPaperState();
  assertProjectExists(state, input.projectId);
  assertSourcesExist(state, input.projectId, input.sourceIds ?? []);
  const now = nowIso();

  const claim: PaperClaim = {
    id: createId("claim"),
    projectId: input.projectId,
    text: input.text,
    section: input.section,
    status: input.status ?? "supported",
    priority: clampNumber(input.priority, 3, 1, 5),
    sourceIds: input.sourceIds ?? [],
    createdBy: input.createdBy ?? "user",
    createdAt: now,
    updatedAt: now
  };

  const evidence = createEvidenceFromSeed(input.projectId, claim.id, input.evidence, input.createdBy ?? "user", now);

  state.claims.unshift(claim);
  state.evidence.unshift(evidence);
  touchProject(state, input.projectId);
  await savePaperState(state);
  return { claim, evidence };
}

export async function addPaperEvidence(input: AddPaperEvidenceInput) {
  const state = await loadPaperState();
  assertProjectExists(state, input.projectId);

  if (input.claimId) {
    assertClaimExists(state, input.projectId, input.claimId);
  }

  const evidence: PaperEvidence = {
    id: createId("ev"),
    projectId: input.projectId,
    claimId: input.claimId,
    type: input.type ?? "note",
    summary: input.summary,
    source: input.source,
    locator: input.locator,
    quote: input.quote,
    data: input.data,
    createdBy: input.createdBy ?? "user",
    createdAt: nowIso()
  };

  state.evidence.unshift(evidence);

  if (input.claimId) {
    const claim = findClaim(state, input.projectId, input.claimId);
    if (claim.status === "hypothesis" || claim.status === "needs_evidence") {
      claim.status = "supported";
      claim.updatedAt = nowIso();
    }
  }

  touchProject(state, input.projectId);
  await savePaperState(state);
  return evidence;
}

export async function addPaperFramework(input: AddPaperFrameworkInput) {
  const state = await loadPaperState();
  assertProjectExists(state, input.projectId);
  assertClaimsExist(state, input.projectId, input.claimIds ?? []);
  assertEvidenceExist(state, input.projectId, input.evidenceIds ?? []);
  assertSourcesExist(state, input.projectId, input.sourceIds ?? []);
  const now = nowIso();

  const framework: PaperFramework = {
    id: createId("fw"),
    projectId: input.projectId,
    name: input.name,
    description: input.description,
    components: input.components ?? [],
    justification: requireNonEmpty(input.justification, "Every framework requires a justification."),
    claimIds: input.claimIds ?? [],
    evidenceIds: input.evidenceIds ?? [],
    sourceIds: input.sourceIds ?? [],
    createdBy: input.createdBy ?? "user",
    createdAt: now,
    updatedAt: now
  };

  state.frameworks.unshift(framework);
  touchProject(state, input.projectId);
  await savePaperState(state);
  return framework;
}

export async function addPaperExperiment(input: AddPaperExperimentInput) {
  const state = await loadPaperState();
  assertProjectExists(state, input.projectId);
  const now = nowIso();

  const experiment: PaperExperiment = {
    id: createId("exp"),
    projectId: input.projectId,
    title: input.title,
    hypothesis: input.hypothesis,
    status: input.status ?? "planned",
    command: input.command,
    codeRef: input.codeRef,
    dataset: input.dataset,
    metrics: input.metrics ?? {},
    resultSummary: input.resultSummary,
    artifactPaths: input.artifactPaths ?? [],
    createdBy: input.createdBy ?? "codex",
    createdAt: now,
    updatedAt: now
  };

  state.experiments.unshift(experiment);
  touchProject(state, input.projectId);
  await savePaperState(state);
  return experiment;
}

export async function addPaperFigure(input: AddPaperFigureInput) {
  const state = await loadPaperState();
  assertProjectExists(state, input.projectId);
  assertClaimsExist(state, input.projectId, input.claimIds ?? []);
  assertExperimentsExist(state, input.projectId, input.experimentIds ?? []);
  const now = nowIso();

  const figure: PaperFigure = {
    id: createId("fig"),
    projectId: input.projectId,
    title: input.title,
    path: input.path,
    caption: input.caption,
    claimIds: input.claimIds ?? [],
    experimentIds: input.experimentIds ?? [],
    createdBy: input.createdBy ?? "codex",
    createdAt: now,
    updatedAt: now
  };

  state.figures.unshift(figure);
  touchProject(state, input.projectId);
  await savePaperState(state);
  return figure;
}

export async function upsertPaperOutline(input: UpsertPaperOutlineInput) {
  const state = await loadPaperState();
  assertProjectExists(state, input.projectId);
  assertClaimsExist(state, input.projectId, input.claimIds ?? []);
  assertEvidenceExist(state, input.projectId, input.evidenceIds ?? []);
  const relatedWorkAnchor = normalizeRelatedWorkAnchor(state, input.projectId, input.relatedWorkAnchor);

  const existing = state.outlineSections.find(
    (section) => section.projectId === input.projectId && section.name === input.name
  );

  if (existing) {
    existing.goal = input.goal ?? existing.goal;
    existing.bullets = input.bullets ?? existing.bullets;
    existing.claimIds = input.claimIds ?? existing.claimIds;
    existing.evidenceIds = input.evidenceIds ?? existing.evidenceIds;
    existing.relatedWorkAnchor = relatedWorkAnchor;
    existing.status = input.status ?? existing.status;
    existing.order = input.order ?? existing.order;
    existing.updatedAt = nowIso();
    touchProject(state, input.projectId);
    await savePaperState(state);
    return existing;
  }

  const section: PaperOutlineSection = {
    id: createId("outline"),
    projectId: input.projectId,
    name: input.name,
    goal: input.goal,
    bullets: input.bullets ?? [],
    claimIds: input.claimIds ?? [],
    evidenceIds: input.evidenceIds ?? [],
    relatedWorkAnchor,
    status: input.status ?? "todo",
    order: input.order ?? nextOutlineOrder(state, input.projectId),
    updatedAt: nowIso()
  };

  state.outlineSections.push(section);
  sortOutlineSections(state);
  touchProject(state, input.projectId);
  await savePaperState(state);
  return section;
}

export async function writePaperSection(input: WritePaperSectionInput) {
  const state = await loadPaperState();
  assertProjectExists(state, input.projectId);
  const now = nowIso();
  const relatedWorkAnchor = normalizeRelatedWorkAnchor(state, input.projectId, input.relatedWorkAnchor);

  const draft: PaperSectionDraft = {
    id: createId("draft"),
    projectId: input.projectId,
    sectionName: input.sectionName,
    content: input.content,
    status: input.status ?? "draft",
    relatedWorkAnchor,
    author: input.author ?? "chatgpt",
    createdAt: now,
    updatedAt: now
  };

  state.sectionDrafts.unshift(draft);
  touchProject(state, input.projectId);
  await savePaperState(state);
  return draft;
}

export async function updatePaperProjectStatus(input: UpdatePaperProjectStatusInput) {
  const state = await loadPaperState();
  const project = touchProject(state, input.projectId);
  project.status = input.status;
  await savePaperState(state);
  return project;
}

export async function listPaperProjects(status?: PaperProjectStatus, limit = 20) {
  const state = await loadPaperState();
  const projects = status ? state.projects.filter((project) => project.status === status) : state.projects;
  return projects.slice(0, clampNumber(limit, 20, 1, 100));
}

export async function getPaperBriefing(projectId: string): Promise<PaperProjectBriefing> {
  const state = await loadPaperState();
  const project = state.projects.find((candidate) => candidate.id === projectId);

  if (!project) {
    throw new Error(`Unknown paper project: ${projectId}`);
  }

  const claims = state.claims.filter((claim) => claim.projectId === projectId);
  const experiments = state.experiments.filter((experiment) => experiment.projectId === projectId);
  const sectionDrafts = state.sectionDrafts.filter((draft) => draft.projectId === projectId);
  const literatureReviews = state.literatureReviews.filter((review) => review.projectId === projectId);
  const insights = state.insights.filter((insight) => insight.projectId === projectId);

  return {
    runtime: getRuntimeMemoryInfo(),
    project,
    notes: state.notes.filter((note) => note.projectId === projectId).slice(0, maxBriefingItems),
    literatureReviews: literatureReviews.slice(0, maxBriefingItems).map((review) => ({
      ...summarizeLiteratureReview(review),
      contentPreview: splitLines(review.content).slice(0, 20).join("\n")
    })),
    insights: insights.slice(0, maxBriefingItems),
    sources: state.sources.filter((source) => source.projectId === projectId).slice(0, maxBriefingItems),
    claims: claims.slice(0, maxBriefingItems),
    evidence: state.evidence.filter((item) => item.projectId === projectId).slice(0, maxBriefingItems),
    frameworks: state.frameworks.filter((framework) => framework.projectId === projectId).slice(0, maxBriefingItems),
    experiments: experiments.slice(0, maxBriefingItems),
    figures: state.figures.filter((figure) => figure.projectId === projectId).slice(0, maxBriefingItems),
    outlineSections: state.outlineSections
      .filter((section) => section.projectId === projectId)
      .sort((left, right) => left.order - right.order),
    sectionDrafts: sectionDrafts.slice(0, maxBriefingItems),
    writingReadiness: {
      supportedClaims: claims.filter((claim) => claim.status === "supported").length,
      claimsNeedingEvidence: claims.filter((claim) => claim.status === "needs_evidence" || claim.status === "hypothesis")
        .length,
      completedExperiments: experiments.filter((experiment) => experiment.status === "completed").length,
      draftSections: sectionDrafts.filter((draft) => draft.status === "draft" || draft.status === "reviewed").length,
      finalSections: sectionDrafts.filter((draft) => draft.status === "final").length
    }
  };
}

export async function searchPaperMemory(query: string, projectId?: string, limit = 20) {
  const state = await loadPaperState();
  const needle = query.toLowerCase();
  const max = clampNumber(limit, 20, 1, 100);
  const matches: Array<{ type: string; id: string; projectId?: string; text: string }> = [];

  function pushMatch(type: string, id: string, candidateProjectId: string | undefined, text: string) {
    if (matches.length >= max) {
      return;
    }

    if (projectId && candidateProjectId !== projectId) {
      return;
    }

    if (text.toLowerCase().includes(needle)) {
      matches.push({ type, id, projectId: candidateProjectId, text });
    }
  }

  for (const project of state.projects) {
    pushMatch("project", project.id, project.id, `${project.title}\n${project.researchQuestion}\n${project.notes ?? ""}`);
  }

  for (const source of state.sources) {
    pushMatch(
      "source",
      source.id,
      source.projectId,
      `${source.title}\n${source.summary ?? ""}\n${source.contributions.join("\n")}\n${source.limitations.join("\n")}`
    );
  }

  for (const claim of state.claims) {
    pushMatch("claim", claim.id, claim.projectId, claim.text);
  }

  for (const evidence of state.evidence) {
    pushMatch("evidence", evidence.id, evidence.projectId, `${evidence.summary}\n${evidence.source ?? ""}\n${evidence.locator ?? ""}`);
  }

  for (const framework of state.frameworks) {
    pushMatch(
      "framework",
      framework.id,
      framework.projectId,
      `${framework.name}\n${framework.description ?? ""}\n${framework.components.join("\n")}\n${framework.justification}`
    );
  }

  for (const experiment of state.experiments) {
    pushMatch(
      "experiment",
      experiment.id,
      experiment.projectId,
      `${experiment.title}\n${experiment.hypothesis ?? ""}\n${experiment.resultSummary ?? ""}`
    );
  }

  for (const figure of state.figures) {
    pushMatch("figure", figure.id, figure.projectId, `${figure.title}\n${figure.caption ?? ""}\n${figure.path}`);
  }

  for (const section of state.outlineSections) {
    pushMatch(
      "outline",
      section.id,
      section.projectId,
      `${section.name}\n${section.goal ?? ""}\n${section.bullets.join("\n")}\n${formatRelatedWorkAnchor(section.relatedWorkAnchor)}`
    );
  }

  for (const draft of state.sectionDrafts) {
    pushMatch(
      "draft",
      draft.id,
      draft.projectId,
      `${draft.sectionName}\n${draft.content}\n${formatRelatedWorkAnchor(draft.relatedWorkAnchor)}`
    );
  }

  for (const note of state.notes) {
    pushMatch("note", note.id, note.projectId, note.text);
  }

  for (const review of state.literatureReviews) {
    pushMatch(
      "literature_review",
      review.id,
      review.projectId,
      `${review.id}\n${review.title}\n${review.summary ?? ""}\n${review.sourcePath ?? ""}\n${review.tags.join("\n")}\n${review.content}`
    );
  }

  for (const insight of state.insights) {
    pushMatch("insight", insight.id, insight.projectId, `${insight.id}\n${insight.title}\n${insight.text}\n${insight.tags.join("\n")}`);
  }

  return matches;
}

export async function getPaperOverview() {
  const state = await loadPaperState();
  return {
    runtime: getRuntimeMemoryInfo(),
    version: state.version,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    counts: {
      projects: state.projects.length,
      sources: state.sources.length,
      claims: state.claims.length,
      evidence: state.evidence.length,
      frameworks: state.frameworks.length,
      experiments: state.experiments.length,
      figures: state.figures.length,
      outlineSections: state.outlineSections.length,
      sectionDrafts: state.sectionDrafts.length,
      notes: state.notes.length,
      literatureReviews: state.literatureReviews.length,
      insights: state.insights.length
    },
    recentProjects: state.projects.slice(0, 10)
  };
}

export async function loadPaperState(): Promise<PaperState> {
  try {
    const raw = await readFile(paperStatePath, "utf8");
    return normalizePaperState(parseJson<Partial<PaperState>>(raw));
  } catch (error: unknown) {
    if (isFileMissingError(error)) {
      const state = createEmptyPaperState();
      await savePaperState(state);
      return state;
    }

    throw error;
  }
}

async function savePaperState(state: PaperState) {
  await mkdir(spaceDataDir, { recursive: true });
  const currentDiskState = await readPaperStateFromDisk();
  const mergedState = currentDiskState ? mergePaperStates(currentDiskState, state) : state;
  mergedState.updatedAt = nowIso();

  const tempPath = path.join(spaceDataDir, `paper-state.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tempPath, `${JSON.stringify(mergedState, null, 2)}\n`, "utf8");
  await renameWithRetry(tempPath, paperStatePath);
}

async function readPaperStateFromDisk(): Promise<PaperState | undefined> {
  try {
    const raw = await readFile(paperStatePath, "utf8");
    return normalizePaperState(parseJson<Partial<PaperState>>(raw));
  } catch (error: unknown) {
    if (isFileMissingError(error)) {
      return undefined;
    }

    throw error;
  }
}

function mergePaperStates(diskState: PaperState, nextState: PaperState): PaperState {
  return {
    ...nextState,
    projects: mergeById(diskState.projects, nextState.projects),
    sources: mergeById(diskState.sources, nextState.sources),
    claims: mergeById(diskState.claims, nextState.claims),
    evidence: mergeById(diskState.evidence, nextState.evidence),
    frameworks: mergeById(diskState.frameworks, nextState.frameworks),
    experiments: mergeById(diskState.experiments, nextState.experiments),
    figures: mergeById(diskState.figures, nextState.figures),
    outlineSections: mergeById(diskState.outlineSections, nextState.outlineSections),
    sectionDrafts: mergeById(diskState.sectionDrafts, nextState.sectionDrafts),
    notes: mergeById(diskState.notes, nextState.notes),
    literatureReviews: mergeById(diskState.literatureReviews, nextState.literatureReviews),
    insights: mergeById(diskState.insights, nextState.insights)
  };
}

function mergeById<T extends { id: string }>(diskItems: T[], nextItems: T[]): T[] {
  const nextIds = new Set(nextItems.map((item) => item.id));
  return [...nextItems, ...diskItems.filter((item) => !nextIds.has(item.id))];
}

function createEmptyPaperState(): PaperState {
  const now = nowIso();
  return {
    version: 2,
    createdAt: now,
    updatedAt: now,
    projects: [],
    sources: [],
    claims: [],
    evidence: [],
    frameworks: [],
    experiments: [],
    figures: [],
    outlineSections: [],
    sectionDrafts: [],
    notes: [],
    literatureReviews: [],
    insights: []
  };
}

function normalizePaperState(state: Partial<PaperState>): PaperState {
  return {
    version: 2,
    createdAt: state.createdAt ?? nowIso(),
    updatedAt: state.updatedAt ?? state.createdAt ?? nowIso(),
    projects: state.projects ?? [],
    sources: state.sources ?? [],
    claims: state.claims ?? [],
    evidence: state.evidence ?? [],
    frameworks: state.frameworks ?? [],
    experiments: state.experiments ?? [],
    figures: state.figures ?? [],
    outlineSections: (state.outlineSections ?? []).map(normalizeOutlineSection),
    sectionDrafts: (state.sectionDrafts ?? []).map(normalizeSectionDraft),
    notes: state.notes ?? [],
    literatureReviews: state.literatureReviews ?? [],
    insights: state.insights ?? []
  };
}

function assertProjectExists(state: PaperState, projectId: string) {
  if (!state.projects.some((project) => project.id === projectId)) {
    throw new Error(`Unknown paper project: ${projectId}`);
  }
}

function assertSourcesExist(state: PaperState, projectId: string, sourceIds: string[]) {
  for (const sourceId of sourceIds) {
    if (!state.sources.some((source) => source.projectId === projectId && source.id === sourceId)) {
      throw new Error(`Unknown source for project ${projectId}: ${sourceId}`);
    }
  }
}

function assertClaimExists(state: PaperState, projectId: string, claimId: string) {
  findClaim(state, projectId, claimId);
}

function assertClaimsExist(state: PaperState, projectId: string, claimIds: string[]) {
  for (const claimId of claimIds) {
    assertClaimExists(state, projectId, claimId);
  }
}

function assertEvidenceExist(state: PaperState, projectId: string, evidenceIds: string[]) {
  for (const evidenceId of evidenceIds) {
    if (!state.evidence.some((evidence) => evidence.projectId === projectId && evidence.id === evidenceId)) {
      throw new Error(`Unknown evidence for project ${projectId}: ${evidenceId}`);
    }
  }
}

function assertExperimentsExist(state: PaperState, projectId: string, experimentIds: string[]) {
  for (const experimentId of experimentIds) {
    if (!state.experiments.some((experiment) => experiment.projectId === projectId && experiment.id === experimentId)) {
      throw new Error(`Unknown experiment for project ${projectId}: ${experimentId}`);
    }
  }
}

function assertLiteratureReviewsExist(state: PaperState, projectId: string, reviewIds: string[]) {
  for (const reviewId of reviewIds) {
    findLiteratureReview(state, projectId, reviewId);
  }
}

function createEvidenceFromSeed(
  projectId: string,
  claimId: string,
  seed: PaperEvidenceSeed,
  fallbackActor: HubActor,
  now: string
): PaperEvidence {
  if (!seed) {
    throw new Error("Every claim requires evidence. Pass evidence.summary plus source, locator, quote, or data when possible.");
  }

  return {
    id: createId("ev"),
    projectId,
    claimId,
    type: seed.type ?? "note",
    summary: requireNonEmpty(seed.summary, "Every claim requires evidence.summary."),
    source: seed.source,
    locator: seed.locator,
    quote: seed.quote,
    data: seed.data,
    createdBy: seed.createdBy ?? fallbackActor,
    createdAt: now
  };
}

function normalizeRelatedWorkAnchor(
  state: PaperState,
  projectId: string,
  anchor: PaperRelatedWorkAnchor | undefined
): PaperRelatedWorkAnchor {
  if (!anchor) {
    throw new Error("Every section requires relatedWorkAnchor with at least a summary and one locator.");
  }

  const normalized: PaperRelatedWorkAnchor = {
    sourceId: anchor.sourceId,
    reviewId: anchor.reviewId,
    citationKey: anchor.citationKey,
    source: anchor.source,
    locator: anchor.locator,
    summary: requireNonEmpty(anchor.summary, "Every section requires relatedWorkAnchor.summary.")
  };

  if (!normalized.sourceId && !normalized.reviewId && !normalized.citationKey && !normalized.source) {
    throw new Error("Every relatedWorkAnchor needs one of sourceId, reviewId, citationKey, or source.");
  }

  if (normalized.sourceId) {
    assertSourcesExist(state, projectId, [normalized.sourceId]);
  }

  if (normalized.reviewId) {
    assertLiteratureReviewsExist(state, projectId, [normalized.reviewId]);
  }

  return normalized;
}

function normalizeOutlineSection(section: PaperOutlineSection): PaperOutlineSection {
  return {
    ...section,
    relatedWorkAnchor: section.relatedWorkAnchor ?? legacyRelatedWorkAnchor()
  };
}

function normalizeSectionDraft(draft: PaperSectionDraft): PaperSectionDraft {
  return {
    ...draft,
    relatedWorkAnchor: draft.relatedWorkAnchor ?? legacyRelatedWorkAnchor()
  };
}

function legacyRelatedWorkAnchor(): PaperRelatedWorkAnchor {
  return {
    source: "legacy-record",
    summary: "Legacy record created before relatedWorkAnchor became required."
  };
}

function formatRelatedWorkAnchor(anchor: PaperRelatedWorkAnchor) {
  return [
    anchor.summary,
    anchor.sourceId,
    anchor.reviewId,
    anchor.citationKey,
    anchor.source,
    anchor.locator
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("\n");
}

function requireNonEmpty(value: string | undefined, message: string) {
  if (!value || value.trim().length === 0) {
    throw new Error(message);
  }

  return value.trim();
}

async function renameWithRetry(sourcePath: string, targetPath: string) {
  const maxAttempts = 8;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await rename(sourcePath, targetPath);
      return;
    } catch (error: unknown) {
      if (!isTransientReplaceError(error)) {
        throw error;
      }

      await delay(25 * attempt);
    }
  }

  await copyFileWithRetry(sourcePath, targetPath);
  await unlink(sourcePath).catch(() => undefined);
}

async function copyFileWithRetry(sourcePath: string, targetPath: string) {
  const maxAttempts = 8;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await copyFile(sourcePath, targetPath);
      return;
    } catch (error: unknown) {
      if (!isTransientReplaceError(error) || attempt === maxAttempts) {
        throw error;
      }

      await delay(25 * attempt);
    }
  }
}

function isTransientReplaceError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "EPERM" || error.code === "EBUSY")
  );
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findSectionForLine(sections: LiteratureReviewSection[], line: number) {
  return sections.find((section) => section.startLine <= line && line <= section.endLine);
}

function findLiteratureReview(state: PaperState, projectId: string, reviewId: string) {
  const review = state.literatureReviews.find((candidate) => candidate.projectId === projectId && candidate.id === reviewId);

  if (!review) {
    throw new Error(`Unknown literature review for project ${projectId}: ${reviewId}`);
  }

  return review;
}

function summarizeLiteratureReview(review: LiteratureReviewArtifact) {
  const { content: _content, ...rest } = review;
  return rest;
}

function extractMarkdownSections(lines: string[]): LiteratureReviewSection[] {
  const headings = lines
    .map((line, index) => {
      const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
      if (!match) {
        return undefined;
      }

      return {
        heading: match[2],
        level: match[1].length,
        startLine: index + 1,
        endLine: lines.length
      };
    })
    .filter((section): section is LiteratureReviewSection => section !== undefined);

  for (let index = 0; index < headings.length; index += 1) {
    headings[index].endLine = (headings[index + 1]?.startLine ?? lines.length + 1) - 1;
  }

  return headings;
}

function splitLines(content: string) {
  return content.split(/\r?\n/);
}

function resolveReadablePath(inputPath: string) {
  const absolutePath = path.resolve(inputPath.startsWith("/") ? inputPath : path.join(workspaceRoot, inputPath));
  const extraImportRoots = (process.env.MCP_HUB_IMPORT_ROOTS ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.resolve(entry));
  const allowedRoots = Array.from(new Set([workspaceRoot, path.resolve(dataDir), path.resolve(spaceDataDir), ...extraImportRoots]));

  if (!allowedRoots.some((root) => absolutePath === root || absolutePath.startsWith(`${root}${path.sep}`))) {
    throw new Error(`Path is outside allowed import roots: ${inputPath}. Add extra roots with MCP_HUB_IMPORT_ROOTS if needed.`);
  }

  return absolutePath;
}

function findClaim(state: PaperState, projectId: string, claimId: string) {
  const claim = state.claims.find((candidate) => candidate.projectId === projectId && candidate.id === claimId);

  if (!claim) {
    throw new Error(`Unknown claim for project ${projectId}: ${claimId}`);
  }

  return claim;
}

function touchProject(state: PaperState, projectId: string) {
  const project = state.projects.find((candidate) => candidate.id === projectId);

  if (!project) {
    throw new Error(`Unknown paper project: ${projectId}`);
  }

  project.updatedAt = nowIso();
  return project;
}

function sortOutlineSections(state: PaperState) {
  state.outlineSections.sort((left, right) => left.order - right.order);
}

function nextOutlineOrder(state: PaperState, projectId: string) {
  const orders = state.outlineSections.filter((section) => section.projectId === projectId).map((section) => section.order);
  return orders.length === 0 ? 1 : Math.max(...orders) + 1;
}

function clampNumber(value: number | undefined, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(Math.max(Math.trunc(value ?? fallback), min), max);
}

function createId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function isFileMissingError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
