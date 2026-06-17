import type { HubActor } from "../hub/types.js";

export type SessionStatus = "active" | "paused" | "completed" | "blocked" | "archived";
export type SessionEventKind =
  | "user_request"
  | "assistant_update"
  | "decision"
  | "command"
  | "file_read"
  | "file_write"
  | "diff"
  | "artifact"
  | "test_result"
  | "error"
  | "handoff"
  | "note";

export interface SessionRecord {
  id: string;
  title: string;
  status: SessionStatus;
  createdBy: HubActor;
  createdAt: string;
  updatedAt: string;
  taskId?: string;
  projectId?: string;
  workspaceRoot?: string;
  objective?: string;
  tags: string[];
}

export interface SessionEvent {
  id: string;
  sessionId: string;
  kind: SessionEventKind;
  actor: HubActor;
  text: string;
  createdAt: string;
  source?: string;
  summary?: string;
  command?: string;
  status?: string;
  exitCode?: number;
  durationMs?: number;
  path?: string;
  artifactPath?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionHandoff {
  id: string;
  sessionId: string;
  actor: HubActor;
  createdAt: string;
  summary: string;
  currentState?: string;
  nextSteps: string[];
  blockers: string[];
  importantFiles: string[];
  openQuestions: string[];
}

export interface SessionState {
  version: 3;
  createdAt: string;
  updatedAt: string;
  sessions: SessionRecord[];
  events: SessionEvent[];
  handoffs: SessionHandoff[];
}
