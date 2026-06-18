import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { getRuntimeMemoryInfo, spaceDataDir } from "../hub/config.js";
import type { HubActor } from "../hub/types.js";
import { parseJson } from "../utils/json.js";
import { sessionStatePath } from "./config.js";
import type {
  SessionEvent,
  SessionEventKind,
  SessionHandoff,
  SessionRecord,
  SessionState,
  SessionStatus
} from "./types.js";

const maxBriefingItems = 50;

export interface CreateSessionInput {
  title: string;
  objective?: string;
  taskId?: string;
  projectId?: string;
  workspaceRoot?: string;
  createdBy?: HubActor;
  tags?: string[];
}

export interface AppendSessionEventInput {
  sessionId: string;
  kind?: SessionEventKind;
  actor?: HubActor;
  text: string;
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

export interface AddCommandEventInput {
  sessionId: string;
  command: string;
  summary?: string;
  status?: string;
  exitCode?: number;
  durationMs?: number;
  stdoutTail?: string;
  stderrTail?: string;
  actor?: HubActor;
  metadata?: Record<string, unknown>;
}

export interface UpsertHandoffInput {
  sessionId: string;
  actor?: HubActor;
  summary: string;
  currentState?: string;
  nextSteps?: string[];
  blockers?: string[];
  importantFiles?: string[];
  openQuestions?: string[];
}

export interface UpdateSessionStatusInput {
  sessionId: string;
  status: SessionStatus;
}

export interface GrepSessionsInput {
  query: string;
  sessionId?: string;
  kind?: SessionEventKind;
  caseSensitive?: boolean;
  maxResults?: number;
  contextLines?: number;
}

export async function createSession(input: CreateSessionInput) {
  const state = await loadSessionState();
  const now = nowIso();
  const session: SessionRecord = {
    id: createId("sess"),
    title: input.title,
    objective: input.objective,
    taskId: input.taskId,
    projectId: input.projectId,
    workspaceRoot: input.workspaceRoot,
    status: "active",
    createdBy: input.createdBy ?? "codex",
    createdAt: now,
    updatedAt: now,
    tags: input.tags ?? []
  };

  state.sessions.unshift(session);
  await saveSessionState(state);
  return session;
}

export async function appendSessionEvent(input: AppendSessionEventInput) {
  const state = await loadSessionState();
  const session = touchSession(state, input.sessionId);
  const event: SessionEvent = {
    id: createId("evt"),
    sessionId: input.sessionId,
    kind: input.kind ?? "note",
    actor: input.actor ?? "codex",
    text: input.text,
    source: input.source,
    summary: input.summary,
    command: input.command,
    status: input.status,
    exitCode: input.exitCode,
    durationMs: input.durationMs,
    path: input.path,
    artifactPath: input.artifactPath,
    metadata: input.metadata,
    createdAt: nowIso()
  };

  session.status = session.status === "paused" ? "active" : session.status;
  state.events.unshift(event);
  await saveSessionState(state);
  return event;
}

export async function addCommandEvent(input: AddCommandEventInput) {
  const outputParts = [
    input.summary,
    input.stdoutTail ? `stdout tail:\n${input.stdoutTail}` : undefined,
    input.stderrTail ? `stderr tail:\n${input.stderrTail}` : undefined
  ].filter(Boolean);

  return appendSessionEvent({
    sessionId: input.sessionId,
    kind: "command",
    actor: input.actor ?? "codex",
    text: outputParts.join("\n\n") || input.command,
    summary: input.summary,
    command: input.command,
    status: input.status,
    exitCode: input.exitCode,
    durationMs: input.durationMs,
    metadata: input.metadata
  });
}

export async function upsertSessionHandoff(input: UpsertHandoffInput) {
  const state = await loadSessionState();
  touchSession(state, input.sessionId);
  const now = nowIso();
  const existing = state.handoffs.find((handoff) => handoff.sessionId === input.sessionId);
  const handoff: SessionHandoff = {
    id: existing?.id ?? createId("handoff"),
    sessionId: input.sessionId,
    actor: input.actor ?? "codex",
    createdAt: now,
    summary: input.summary,
    currentState: input.currentState,
    nextSteps: input.nextSteps ?? [],
    blockers: input.blockers ?? [],
    importantFiles: input.importantFiles ?? [],
    openQuestions: input.openQuestions ?? []
  };

  state.handoffs = [handoff, ...state.handoffs.filter((item) => item.id !== handoff.id)];
  await appendHandoffEvent(state, handoff);
  await saveSessionState(state);
  return handoff;
}

export async function updateSessionStatus(input: UpdateSessionStatusInput) {
  const state = await loadSessionState();
  const session = touchSession(state, input.sessionId);
  session.status = input.status;
  await saveSessionState(state);
  return session;
}

export async function listSessions(status?: SessionStatus, limit = 20) {
  const state = await loadSessionState();
  const sessions = status ? state.sessions.filter((session) => session.status === status) : state.sessions;
  return sessions.slice(0, clampNumber(limit, 20, 1, 100));
}

export async function getSessionHandoff(sessionId: string) {
  const state = await loadSessionState();
  const session = state.sessions.find((candidate) => candidate.id === sessionId);
  if (!session) {
    throw new Error(`Unknown session: ${sessionId}`);
  }

  const events = state.events.filter((event) => event.sessionId === sessionId).slice(0, maxBriefingItems);
  const handoff = state.handoffs.find((item) => item.sessionId === sessionId);

  return {
    session,
    handoff,
    recentEvents: events,
    counts: {
      events: state.events.filter((event) => event.sessionId === sessionId).length,
      commands: state.events.filter((event) => event.sessionId === sessionId && event.kind === "command").length,
      artifacts: state.events.filter((event) => event.sessionId === sessionId && event.kind === "artifact").length,
      errors: state.events.filter((event) => event.sessionId === sessionId && event.kind === "error").length
    }
  };
}

export async function searchSessions(query: string, sessionId?: string, limit = 20) {
  const state = await loadSessionState();
  const needle = query.toLowerCase();
  const max = clampNumber(limit, 20, 1, 100);
  const matches: Array<{ type: string; id: string; sessionId?: string; text: string }> = [];

  function push(type: string, id: string, itemSessionId: string | undefined, text: string) {
    if (matches.length >= max) {
      return;
    }

    if (sessionId && itemSessionId !== sessionId) {
      return;
    }

    if (text.toLowerCase().includes(needle)) {
      matches.push({ type, id, sessionId: itemSessionId, text: text.slice(0, 2000) });
    }
  }

  for (const session of state.sessions) {
    push("session", session.id, session.id, [session.id, session.title, session.objective, session.tags.join(" ")].join("\n"));
  }

  for (const event of state.events) {
    push(
      "event",
      event.id,
      event.sessionId,
      [event.id, event.kind, event.command, event.summary, event.text, event.path, event.artifactPath].join("\n")
    );
  }

  for (const handoff of state.handoffs) {
    push(
      "handoff",
      handoff.id,
      handoff.sessionId,
      [
        handoff.id,
        handoff.summary,
        handoff.currentState,
        handoff.nextSteps.join("\n"),
        handoff.blockers.join("\n"),
        handoff.importantFiles.join("\n"),
        handoff.openQuestions.join("\n")
      ].join("\n")
    );
  }

  return matches;
}

export async function grepSessionEvents(input: GrepSessionsInput) {
  const state = await loadSessionState();
  const maxResults = clampNumber(input.maxResults, 50, 1, 200);
  const contextLines = clampNumber(input.contextLines, 0, 0, 5);
  const needle = input.caseSensitive ? input.query : input.query.toLowerCase();
  const matches: Array<{
    eventId: string;
    sessionId: string;
    kind: SessionEventKind;
    line: number;
    text: string;
    before: string[];
    after: string[];
    command?: string;
    path?: string;
    artifactPath?: string;
    createdAt: string;
  }> = [];

  for (const event of state.events) {
    if (matches.length >= maxResults) {
      break;
    }

    if (input.sessionId && event.sessionId !== input.sessionId) {
      continue;
    }

    if (input.kind && event.kind !== input.kind) {
      continue;
    }

    const haystack = eventToSearchText(event);
    const lines = haystack.split(/\r?\n/);

    for (let index = 0; index < lines.length && matches.length < maxResults; index += 1) {
      const line = lines[index] ?? "";
      const comparable = input.caseSensitive ? line : line.toLowerCase();

      if (!comparable.includes(needle)) {
        continue;
      }

      matches.push({
        eventId: event.id,
        sessionId: event.sessionId,
        kind: event.kind,
        line: index + 1,
        text: line,
        before: lines.slice(Math.max(0, index - contextLines), index),
        after: lines.slice(index + 1, index + 1 + contextLines),
        command: event.command,
        path: event.path,
        artifactPath: event.artifactPath,
        createdAt: event.createdAt
      });
    }
  }

  return matches;
}

export async function readSessionEvent(eventId: string) {
  const state = await loadSessionState();
  const event = state.events.find((candidate) => candidate.id === eventId);
  if (!event) {
    throw new Error(`Unknown session event: ${eventId}`);
  }

  return event;
}

export async function getSessionOverview() {
  const state = await loadSessionState();
  return {
    runtime: getRuntimeMemoryInfo(),
    version: state.version,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    counts: {
      sessions: state.sessions.length,
      events: state.events.length,
      handoffs: state.handoffs.length,
      commandEvents: state.events.filter((event) => event.kind === "command").length,
      artifactEvents: state.events.filter((event) => event.kind === "artifact").length
    },
    recentSessions: state.sessions.slice(0, 10),
    latestHandoff: state.handoffs[0]
  };
}

function eventToSearchText(event: SessionEvent) {
  return [
    event.id,
    event.kind,
    event.command,
    event.summary,
    event.text,
    event.path,
    event.artifactPath,
    event.status,
    event.exitCode === undefined ? undefined : `exitCode=${event.exitCode}`,
    event.metadata ? JSON.stringify(event.metadata) : undefined
  ]
    .filter(Boolean)
    .join("\n");
}

export async function loadSessionState(): Promise<SessionState> {
  try {
    const raw = await readFile(sessionStatePath, "utf8");
    return normalizeSessionState(parseJson<Partial<SessionState>>(raw));
  } catch (error: unknown) {
    if (isFileMissingError(error)) {
      const state = createEmptySessionState();
      await saveSessionState(state);
      return state;
    }

    throw error;
  }
}

async function appendHandoffEvent(state: SessionState, handoff: SessionHandoff) {
  const event: SessionEvent = {
    id: createId("evt"),
    sessionId: handoff.sessionId,
    kind: "handoff",
    actor: handoff.actor,
    text: handoff.summary,
    summary: handoff.summary,
    metadata: {
      currentState: handoff.currentState,
      nextSteps: handoff.nextSteps,
      blockers: handoff.blockers,
      importantFiles: handoff.importantFiles,
      openQuestions: handoff.openQuestions
    },
    createdAt: handoff.createdAt
  };

  state.events.unshift(event);
}

async function saveSessionState(state: SessionState) {
  await mkdir(spaceDataDir, { recursive: true });
  const diskState = await readSessionStateFromDisk();
  const mergedState = diskState ? mergeSessionStates(diskState, state) : state;
  mergedState.updatedAt = nowIso();

  const tempPath = path.join(spaceDataDir, `session-state.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tempPath, `${JSON.stringify(mergedState, null, 2)}\n`, "utf8");
  await rename(tempPath, sessionStatePath);
}

async function readSessionStateFromDisk(): Promise<SessionState | undefined> {
  try {
    const raw = await readFile(sessionStatePath, "utf8");
    return normalizeSessionState(parseJson<Partial<SessionState>>(raw));
  } catch (error: unknown) {
    if (isFileMissingError(error)) {
      return undefined;
    }

    throw error;
  }
}

function mergeSessionStates(diskState: SessionState, nextState: SessionState): SessionState {
  return {
    ...nextState,
    sessions: mergeById(diskState.sessions, nextState.sessions),
    events: mergeById(diskState.events, nextState.events),
    handoffs: mergeById(diskState.handoffs, nextState.handoffs)
  };
}

function mergeById<T extends { id: string }>(diskItems: T[], nextItems: T[]): T[] {
  const nextIds = new Set(nextItems.map((item) => item.id));
  return [...nextItems, ...diskItems.filter((item) => !nextIds.has(item.id))];
}

function createEmptySessionState(): SessionState {
  const now = nowIso();
  return {
    version: 3,
    createdAt: now,
    updatedAt: now,
    sessions: [],
    events: [],
    handoffs: []
  };
}

function normalizeSessionState(state: Partial<SessionState>): SessionState {
  return {
    version: 3,
    createdAt: state.createdAt ?? nowIso(),
    updatedAt: state.updatedAt ?? state.createdAt ?? nowIso(),
    sessions: state.sessions ?? [],
    events: state.events ?? [],
    handoffs: state.handoffs ?? []
  };
}

function touchSession(state: SessionState, sessionId: string) {
  const session = state.sessions.find((candidate) => candidate.id === sessionId);
  if (!session) {
    throw new Error(`Unknown session: ${sessionId}`);
  }

  session.updatedAt = nowIso();
  return session;
}

function createId(prefix: string) {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

function nowIso() {
  return new Date().toISOString();
}

function clampNumber(value: number | undefined, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function isFileMissingError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
