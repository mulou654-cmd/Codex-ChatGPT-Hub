export type HubActor = "codex" | "chatgpt" | "user" | "system";

export type HubTaskStatus = "open" | "planned" | "executing" | "blocked" | "done" | "archived";

export type HubContextKind =
  | "conversation"
  | "requirement"
  | "constraint"
  | "file_summary"
  | "decision"
  | "log"
  | "note";

export type HubPlanStatus = "proposed" | "accepted" | "superseded";

export type HubExecutionStatus = "started" | "progress" | "passed" | "failed" | "blocked" | "done";

export interface HubTask {
  id: string;
  title: string;
  description: string;
  status: HubTaskStatus;
  createdBy: HubActor;
  createdAt: string;
  updatedAt: string;
  tags: string[];
}

export interface HubContextEntry {
  id: string;
  taskId?: string;
  kind: HubContextKind;
  actor: HubActor;
  text: string;
  createdAt: string;
  source?: string;
}

export interface HubPlan {
  id: string;
  taskId: string;
  actor: HubActor;
  title: string;
  plan: string;
  status: HubPlanStatus;
  createdAt: string;
}

export interface HubExecutionResult {
  id: string;
  taskId: string;
  actor: HubActor;
  status: HubExecutionStatus;
  summary: string;
  details?: string;
  createdAt: string;
}

export interface WorkspaceSnapshot {
  id: string;
  actor: HubActor;
  workspaceRoot: string;
  createdAt: string;
  branch?: string;
  gitStatus?: string;
  files: string[];
  note?: string;
}

export interface HubState {
  version: 1;
  createdAt: string;
  updatedAt: string;
  tasks: HubTask[];
  contexts: HubContextEntry[];
  plans: HubPlan[];
  executionResults: HubExecutionResult[];
  workspaceSnapshots: WorkspaceSnapshot[];
}
