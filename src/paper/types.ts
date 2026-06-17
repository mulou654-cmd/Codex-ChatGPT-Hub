import type { HubActor } from "../hub/types.js";

export type PaperProjectStatus = "active" | "paused" | "submitted" | "published" | "archived";
export type PaperSourceType = "paper" | "book" | "dataset" | "website" | "code" | "note";
export type PaperClaimStatus = "hypothesis" | "supported" | "contested" | "rejected" | "needs_evidence";
export type PaperEvidenceType = "source" | "experiment" | "figure" | "code" | "dataset" | "note";
export type PaperExperimentStatus = "planned" | "running" | "completed" | "failed" | "abandoned";
export type PaperSectionStatus = "todo" | "draft" | "reviewed" | "final";
export type LiteratureReviewKind = "survey" | "summary" | "related_work" | "reading_notes";
export type PaperInsightKind = "innovation" | "feasibility" | "risk" | "experiment_idea" | "positioning" | "critique";
export type PaperInsightStatus = "proposed" | "accepted" | "rejected" | "needs_evidence" | "needs_experiment";

export interface PaperProject {
  id: string;
  title: string;
  researchQuestion: string;
  status: PaperProjectStatus;
  createdBy: HubActor;
  createdAt: string;
  updatedAt: string;
  venue?: string;
  deadline?: string;
  keywords: string[];
  notes?: string;
}

export interface PaperSource {
  id: string;
  projectId: string;
  type: PaperSourceType;
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  url?: string;
  filePath?: string;
  citationKey?: string;
  summary?: string;
  contributions: string[];
  limitations: string[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PaperClaim {
  id: string;
  projectId: string;
  text: string;
  section?: string;
  status: PaperClaimStatus;
  priority: number;
  sourceIds: string[];
  createdBy: HubActor;
  createdAt: string;
  updatedAt: string;
}

export interface PaperEvidenceSeed {
  type?: PaperEvidenceType;
  summary: string;
  source?: string;
  locator?: string;
  quote?: string;
  data?: Record<string, unknown>;
  createdBy?: HubActor;
}

export interface PaperEvidence {
  id: string;
  projectId: string;
  claimId?: string;
  type: PaperEvidenceType;
  summary: string;
  source?: string;
  locator?: string;
  quote?: string;
  data?: Record<string, unknown>;
  createdBy: HubActor;
  createdAt: string;
}

export interface PaperFramework {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  components: string[];
  justification: string;
  claimIds: string[];
  evidenceIds: string[];
  sourceIds: string[];
  createdBy: HubActor;
  createdAt: string;
  updatedAt: string;
}

export interface PaperExperiment {
  id: string;
  projectId: string;
  title: string;
  hypothesis?: string;
  status: PaperExperimentStatus;
  command?: string;
  codeRef?: string;
  dataset?: string;
  metrics: Record<string, unknown>;
  resultSummary?: string;
  artifactPaths: string[];
  createdBy: HubActor;
  createdAt: string;
  updatedAt: string;
}

export interface PaperFigure {
  id: string;
  projectId: string;
  title: string;
  path: string;
  caption?: string;
  claimIds: string[];
  experimentIds: string[];
  createdBy: HubActor;
  createdAt: string;
  updatedAt: string;
}

export interface PaperRelatedWorkAnchor {
  sourceId?: string;
  reviewId?: string;
  citationKey?: string;
  source?: string;
  locator?: string;
  summary: string;
}

export interface PaperOutlineSection {
  id: string;
  projectId: string;
  name: string;
  goal?: string;
  bullets: string[];
  claimIds: string[];
  evidenceIds: string[];
  relatedWorkAnchor: PaperRelatedWorkAnchor;
  status: PaperSectionStatus;
  order: number;
  updatedAt: string;
}

export interface PaperSectionDraft {
  id: string;
  projectId: string;
  sectionName: string;
  content: string;
  status: PaperSectionStatus;
  relatedWorkAnchor: PaperRelatedWorkAnchor;
  author: HubActor;
  createdAt: string;
  updatedAt: string;
}

export interface PaperNote {
  id: string;
  projectId: string;
  actor: HubActor;
  kind: "research" | "writing" | "decision" | "todo" | "log";
  text: string;
  createdAt: string;
  source?: string;
}

export interface LiteratureReviewSection {
  heading: string;
  level: number;
  startLine: number;
  endLine: number;
}

export interface LiteratureReviewArtifact {
  id: string;
  projectId: string;
  title: string;
  kind: LiteratureReviewKind;
  sourcePath?: string;
  importedBy: HubActor;
  createdAt: string;
  updatedAt: string;
  lineCount: number;
  charCount: number;
  summary?: string;
  content: string;
  sections: LiteratureReviewSection[];
  tags: string[];
}

export interface PaperInsight {
  id: string;
  projectId: string;
  kind: PaperInsightKind;
  title: string;
  text: string;
  status: PaperInsightStatus;
  createdBy: HubActor;
  createdAt: string;
  updatedAt: string;
  reviewIds: string[];
  claimIds: string[];
  evidenceIds: string[];
  experimentIds: string[];
  tags: string[];
}

export interface PaperState {
  version: 2;
  createdAt: string;
  updatedAt: string;
  projects: PaperProject[];
  sources: PaperSource[];
  claims: PaperClaim[];
  evidence: PaperEvidence[];
  frameworks: PaperFramework[];
  experiments: PaperExperiment[];
  figures: PaperFigure[];
  outlineSections: PaperOutlineSection[];
  sectionDrafts: PaperSectionDraft[];
  notes: PaperNote[];
  literatureReviews: LiteratureReviewArtifact[];
  insights: PaperInsight[];
}
