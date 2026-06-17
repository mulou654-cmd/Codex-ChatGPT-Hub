import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { runsDir } from "./config.js";

export type RunLogKind = "stdout" | "stderr";
export type RunArtifactKind =
  | "metrics"
  | "figure"
  | "report"
  | "table"
  | "config"
  | "checkpoint"
  | "dataset"
  | "log"
  | "other";

export interface RunMeta {
  runId: string;
  sessionId: string;
  command: string[];
  cwd: string;
  exitCode: number;
  durationMs: number;
  startedAt: string;
  endedAt: string;
  stdoutPath: string;
  stderrPath: string;
  diffPath: string;
  artifactsDir?: string;
  manifestPath?: string;
  artifacts?: {
    total: number;
    byKind: Record<string, number>;
  };
}

export interface RunArtifactManifestItem {
  path: string;
  kind: RunArtifactKind;
  label?: string;
  description?: string;
  tags?: string[];
  mediaType?: string;
  size?: number;
  updatedAt?: string;
}

export interface RunManifest {
  version: 1;
  runId: string;
  generatedAt: string;
  artifacts: RunArtifactManifestItem[];
}

export interface ReadRunTextInput {
  runId: string;
  kind?: RunLogKind;
  startLine?: number;
  maxLines?: number;
}

export interface GrepRunInput {
  runId?: string;
  query: string;
  kind?: RunLogKind | "diff" | "all";
  caseSensitive?: boolean;
  maxResults?: number;
  contextLines?: number;
}

export interface ReadRunFileInput {
  runId: string;
  path: string;
  startLine?: number;
  maxLines?: number;
}

export interface UpsertRunArtifactInput {
  runId: string;
  path: string;
  kind: RunArtifactKind;
  label?: string;
  description?: string;
  tags?: string[];
}

export interface CleanupRunsInput {
  maxAgeDays?: number;
  keepLast?: number;
  includeFailed?: boolean;
  dryRun?: boolean;
  confirm?: string;
}

interface RunIndexEntry {
  runId: string;
  sessionId?: string;
  command?: string[];
  exitCode?: number;
  durationMs?: number;
  startedAt?: string;
  endedAt?: string;
  updatedAt?: string;
  sizeBytes: number;
  artifacts: {
    total: number;
    byKind: Record<string, number>;
  };
}

interface RunIndex {
  version: 1;
  generatedAt: string;
  runs: RunIndexEntry[];
}

const textExtensions = new Set([
  ".csv",
  ".diff",
  ".html",
  ".json",
  ".jsonl",
  ".log",
  ".md",
  ".patch",
  ".txt",
  ".yaml",
  ".yml"
]);

const figureExtensions = new Set([".gif", ".jpeg", ".jpg", ".pdf", ".png", ".svg", ".webp"]);
const checkpointExtensions = new Set([".bin", ".ckpt", ".onnx", ".pt", ".pth", ".safetensors"]);
const datasetExtensions = new Set([".arrow", ".parquet", ".sqlite", ".db"]);
const indexPath = path.join(runsDir, "index.json");

export async function listRuns(limit = 20) {
  const indexed = await readRunIndex().catch(() => undefined);
  if (indexed) {
    return indexed.runs
      .sort((left, right) =>
        String(right.endedAt ?? right.updatedAt).localeCompare(String(left.endedAt ?? left.updatedAt))
      )
      .slice(0, clampNumber(limit, 20, 1, 100));
  }

  const entries = await readdir(runsDir, { withFileTypes: true }).catch(() => []);
  const runs = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("run_"))
      .map(async (entry) => {
        const runId = entry.name;
        const meta = await readRunMeta(runId).catch(() => undefined);
        const stats = await stat(path.join(runsDir, runId)).catch(() => undefined);
        const manifest = await readRunManifest(runId).catch(() => undefined);
        return {
          runId,
          sessionId: meta?.sessionId,
          command: meta?.command,
          exitCode: meta?.exitCode,
          durationMs: meta?.durationMs,
          startedAt: meta?.startedAt,
          endedAt: meta?.endedAt,
          updatedAt: stats?.mtime.toISOString(),
          sizeBytes: 0,
          artifacts: summarizeArtifacts(manifest)
        };
      })
  );

  return runs
    .sort((left, right) => String(right.endedAt ?? right.updatedAt).localeCompare(String(left.endedAt ?? left.updatedAt)))
    .slice(0, clampNumber(limit, 20, 1, 100));
}

export async function readRunMeta(runId: string): Promise<RunMeta> {
  const metaPath = resolveRunPath(runId, "meta.json");
  return JSON.parse(await readFile(metaPath, "utf8")) as RunMeta;
}

export async function readRunManifest(runId: string): Promise<RunManifest> {
  const manifestPath = resolveRunPath(runId, "manifest.json");
  return JSON.parse(await readFile(manifestPath, "utf8")) as RunManifest;
}

export async function writeRunManifest(runId: string) {
  assertRunId(runId);
  const existing = await readRunManifest(runId).catch(() => undefined);
  const previousByPath = new Map((existing?.artifacts ?? []).map((artifact) => [artifact.path, artifact]));
  const runRoot = path.resolve(runsDir, runId);
  const artifactsRoot = path.join(runRoot, "artifacts");
  const files = await listFilesUnder(artifactsRoot, runRoot);
  const artifacts: RunArtifactManifestItem[] = [];

  for (const file of files) {
    const previous = previousByPath.get(file.path);
    artifacts.push({
      path: file.path,
      kind: previous?.kind ?? inferArtifactKind(file.path),
      label: previous?.label ?? inferArtifactLabel(file.path),
      description: previous?.description,
      tags: previous?.tags,
      mediaType: inferMediaType(file.path),
      size: file.size,
      updatedAt: file.updatedAt
    });
  }

  const manifest: RunManifest = {
    version: 1,
    runId,
    generatedAt: new Date().toISOString(),
    artifacts: artifacts.sort((left, right) => left.path.localeCompare(right.path))
  };

  await writeFile(resolveRunPath(runId, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export async function upsertRunArtifact(input: UpsertRunArtifactInput) {
  assertRunId(input.runId);
  assertArtifactKind(input.kind);

  const safePath = normalizeRunRelativePath(input.path);
  const absolutePath = resolveRunPath(input.runId, safePath);
  const stats = await stat(absolutePath);
  if (!stats.isFile()) {
    throw new Error(`Run artifact path is not a file: ${safePath}`);
  }

  const manifest: RunManifest = await readRunManifest(input.runId).catch(() => ({
    version: 1,
    runId: input.runId,
    generatedAt: new Date().toISOString(),
    artifacts: [] as RunArtifactManifestItem[]
  }));
  const existingIndex = manifest.artifacts.findIndex((artifact) => artifact.path === safePath);
  const artifact: RunArtifactManifestItem = {
    path: safePath,
    kind: input.kind,
    label: input.label ?? inferArtifactLabel(safePath),
    description: input.description,
    tags: input.tags,
    mediaType: inferMediaType(safePath),
    size: stats.size,
    updatedAt: stats.mtime.toISOString()
  };

  if (existingIndex === -1) {
    manifest.artifacts.push(artifact);
  } else {
    manifest.artifacts[existingIndex] = {
      ...manifest.artifacts[existingIndex],
      ...artifact
    };
  }

  manifest.generatedAt = new Date().toISOString();
  manifest.artifacts.sort((left, right) => left.path.localeCompare(right.path));
  await writeFile(resolveRunPath(input.runId, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rebuildRunIndex();
  return manifest;
}

export async function readRunLog(input: ReadRunTextInput) {
  return readRunText(input.runId, input.kind === "stderr" ? "stderr.log" : "stdout.log", input.startLine, input.maxLines);
}

export async function readRunDiff(input: Omit<ReadRunTextInput, "kind">) {
  return readRunText(input.runId, "diff.patch", input.startLine, input.maxLines);
}

export async function listRunFiles(runId: string) {
  assertRunId(runId);
  const runRoot = path.resolve(runsDir, runId);
  const manifest = await readRunManifest(runId).catch(() => undefined);
  const manifestByPath = new Map((manifest?.artifacts ?? []).map((artifact) => [artifact.path, artifact]));
  const files: Array<{
    path: string;
    size: number;
    updatedAt: string;
    readable: boolean;
    kind?: RunArtifactKind;
    label?: string;
    description?: string;
    tags?: string[];
  }> = [];

  async function walk(directory: string) {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(runRoot, absolutePath);

      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile()) {
        const stats = await stat(absolutePath);
        const artifact = manifestByPath.get(relativePath);
        files.push({
          path: relativePath,
          size: stats.size,
          updatedAt: stats.mtime.toISOString(),
          readable: isReadableTextFile(relativePath),
          kind: artifact?.kind,
          label: artifact?.label,
          description: artifact?.description,
          tags: artifact?.tags
        });
      }
    }
  }

  await walk(runRoot);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

export async function readRunFile(input: ReadRunFileInput) {
  if (!isReadableTextFile(input.path)) {
    throw new Error(`Refusing to read unsupported run file type: ${input.path}`);
  }

  return readRunText(input.runId, input.path, input.startLine, input.maxLines);
}

export async function grepRuns(input: GrepRunInput) {
  const maxResults = clampNumber(input.maxResults, 50, 1, 200);
  const contextLines = clampNumber(input.contextLines, 0, 0, 5);
  const needle = input.caseSensitive ? input.query : input.query.toLowerCase();
  const runIds = input.runId ? [input.runId] : (await listRuns(100)).map((run) => run.runId);
  const matches: Array<{
    runId: string;
    file: string;
    line: number;
    text: string;
    before: string[];
    after: string[];
  }> = [];

  for (const runId of runIds) {
    if (matches.length >= maxResults) {
      break;
    }

    for (const file of await filesForKind(runId, input.kind ?? "all")) {
      if (matches.length >= maxResults) {
        break;
      }

      const content = await readFile(resolveRunPath(runId, file), "utf8").catch(() => undefined);
      if (!content) {
        continue;
      }

      const lines = splitLines(content);
      for (let index = 0; index < lines.length && matches.length < maxResults; index += 1) {
        const line = lines[index] ?? "";
        const comparable = input.caseSensitive ? line : line.toLowerCase();

        if (!comparable.includes(needle)) {
          continue;
        }

        matches.push({
          runId,
          file,
          line: index + 1,
          text: line,
          before: lines.slice(Math.max(0, index - contextLines), index),
          after: lines.slice(index + 1, index + 1 + contextLines)
        });
      }
    }
  }

  return matches;
}

export async function getRunOverview() {
  const index = await readRunIndex().catch(() => undefined);
  const runs = index?.runs ?? (await rebuildRunIndex()).runs;
  const totalSizeBytes = runs.reduce((sum, run) => sum + run.sizeBytes, 0);
  const byExitCode = runs.reduce<Record<string, number>>((acc, run) => {
    const key = typeof run.exitCode === "number" ? String(run.exitCode) : "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const artifactKinds = runs.reduce<Record<string, number>>((acc, run) => {
    for (const [kind, count] of Object.entries(run.artifacts.byKind)) {
      acc[kind] = (acc[kind] ?? 0) + count;
    }
    return acc;
  }, {});

  return {
    totalRuns: runs.length,
    totalSizeBytes,
    newestRunAt: runs[0]?.endedAt ?? runs[0]?.updatedAt,
    oldestRunAt: runs.at(-1)?.endedAt ?? runs.at(-1)?.updatedAt,
    byExitCode,
    artifactKinds,
    index: {
      generatedAt: index?.generatedAt,
      path: indexPath
    }
  };
}

export async function rebuildRunIndex(): Promise<RunIndex> {
  await mkdir(runsDir, { recursive: true });
  const entries = await readdir(runsDir, { withFileTypes: true }).catch(() => []);
  const runs: RunIndexEntry[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("run_")) {
      continue;
    }

    const runId = entry.name;
    const runRoot = path.join(runsDir, runId);
    const meta = await readRunMeta(runId).catch(() => undefined);
    const manifest = (await readRunManifest(runId).catch(() => undefined)) ?? (await writeRunManifest(runId).catch(() => undefined));
    const stats = await stat(runRoot).catch(() => undefined);
    const sizeBytes = await directorySize(runRoot);

    runs.push({
      runId,
      sessionId: meta?.sessionId,
      command: meta?.command,
      exitCode: meta?.exitCode,
      durationMs: meta?.durationMs,
      startedAt: meta?.startedAt,
      endedAt: meta?.endedAt,
      updatedAt: stats?.mtime.toISOString(),
      sizeBytes,
      artifacts: summarizeArtifacts(manifest)
    });
  }

  const index: RunIndex = {
    version: 1,
    generatedAt: new Date().toISOString(),
    runs: runs.sort((left, right) =>
      String(right.endedAt ?? right.updatedAt).localeCompare(String(left.endedAt ?? left.updatedAt))
    )
  };

  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return index;
}

export async function cleanupRuns(input: CleanupRunsInput = {}) {
  const maxAgeDays = clampNumber(input.maxAgeDays, 30, 1, 3650);
  const keepLast = clampNumber(input.keepLast, 50, 0, 10000);
  const includeFailed = input.includeFailed === true;
  const dryRun = input.dryRun !== false;
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const index = await rebuildRunIndex();
  const keep = new Set(index.runs.slice(0, keepLast).map((run) => run.runId));
  const candidates = index.runs.filter((run) => {
    if (keep.has(run.runId)) {
      return false;
    }

    if (!includeFailed && typeof run.exitCode === "number" && run.exitCode !== 0) {
      return false;
    }

    const timestamp = Date.parse(run.endedAt ?? run.updatedAt ?? "");
    return Number.isFinite(timestamp) && timestamp < cutoff;
  });

  if (!dryRun && input.confirm !== "DELETE_RUN_ARCHIVES") {
    throw new Error('Actual cleanup requires confirm: "DELETE_RUN_ARCHIVES".');
  }

  let freedBytes = 0;
  const deleted: string[] = [];

  for (const candidate of candidates) {
    freedBytes += candidate.sizeBytes;
    if (!dryRun) {
      await rm(path.join(runsDir, candidate.runId), { recursive: true, force: true });
      deleted.push(candidate.runId);
    }
  }

  if (!dryRun) {
    await rebuildRunIndex();
  }

  return {
    dryRun,
    maxAgeDays,
    keepLast,
    includeFailed,
    candidates: candidates.map((run) => ({
      runId: run.runId,
      endedAt: run.endedAt,
      exitCode: run.exitCode,
      sizeBytes: run.sizeBytes
    })),
    deleted,
    freedBytes
  };
}

async function readRunText(runId: string, fileName: string, startLine?: number, maxLines?: number) {
  const filePath = resolveRunPath(runId, fileName);
  const content = await readFile(filePath, "utf8");
  const lines = splitLines(content);
  const start = clampNumber(startLine, 1, 1, Math.max(lines.length, 1));
  const max = clampNumber(maxLines, 200, 1, 1000);
  const selected = lines.slice(start - 1, start - 1 + max);

  return {
    runId,
    file: fileName,
    startLine: start,
    endLine: start + selected.length - 1,
    totalLines: lines.length,
    content: selected.join("\n")
  };
}

function resolveRunPath(runId: string, fileName: string) {
  assertRunId(runId);

  const safeFileName = normalizeRunRelativePath(fileName);
  const absolutePath = path.resolve(runsDir, runId, safeFileName);
  const runRoot = path.resolve(runsDir, runId);

  if (absolutePath !== runRoot && !absolutePath.startsWith(`${runRoot}${path.sep}`)) {
    throw new Error(`Path is outside run directory: ${fileName}`);
  }

  return absolutePath;
}

async function filesForKind(runId: string, kind: RunLogKind | "diff" | "all") {
  if (kind === "stdout") {
    return ["stdout.log"];
  }

  if (kind === "stderr") {
    return ["stderr.log"];
  }

  if (kind === "diff") {
    return ["diff.patch"];
  }

  return (await listRunFiles(runId)).filter((file) => file.readable).map((file) => file.path);
}

function assertRunId(runId: string) {
  if (!/^run_[a-z0-9]+_[a-f0-9]+$/i.test(runId)) {
    throw new Error(`Invalid run id: ${runId}`);
  }
}

function isReadableTextFile(filePath: string) {
  const normalized = filePath.replaceAll("\\", "/");
  if (normalized.includes("../") || normalized.startsWith("/") || normalized.startsWith("..")) {
    return false;
  }

  const extension = path.extname(normalized);
  return textExtensions.has(extension);
}

function normalizeRunRelativePath(filePath: string) {
  const normalized = filePath.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("../") || normalized.startsWith("..")) {
    throw new Error(`Invalid run file path: ${filePath}`);
  }

  return normalized;
}

async function readRunIndex(): Promise<RunIndex> {
  const index = JSON.parse(await readFile(indexPath, "utf8")) as RunIndex;
  if (index.version !== 1 || !Array.isArray(index.runs)) {
    throw new Error("Invalid run index.");
  }

  return index;
}

async function listFilesUnder(directory: string, root: string) {
  const files: Array<{ path: string; size: number; updatedAt: string }> = [];

  async function walk(current: string) {
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile()) {
        const stats = await stat(absolutePath);
        files.push({
          path: path.relative(root, absolutePath),
          size: stats.size,
          updatedAt: stats.mtime.toISOString()
        });
      }
    }
  }

  await walk(directory);
  return files;
}

async function directorySize(directory: string): Promise<number> {
  let total = 0;
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      total += await directorySize(absolutePath);
    } else if (entry.isFile()) {
      const stats = await stat(absolutePath);
      total += stats.size;
    }
  }

  return total;
}

function summarizeArtifacts(manifest?: RunManifest) {
  const byKind = (manifest?.artifacts ?? []).reduce<Record<string, number>>((acc, artifact) => {
    acc[artifact.kind] = (acc[artifact.kind] ?? 0) + 1;
    return acc;
  }, {});

  return {
    total: manifest?.artifacts.length ?? 0,
    byKind
  };
}

function inferArtifactKind(filePath: string): RunArtifactKind {
  const baseName = path.basename(filePath).toLowerCase();
  const extension = path.extname(baseName);

  if (baseName.includes("metric") || baseName.includes("score") || baseName.includes("result")) {
    return "metrics";
  }

  if (baseName.includes("report") || baseName.includes("summary") || extension === ".md" || extension === ".html") {
    return "report";
  }

  if (baseName.includes("table") || extension === ".csv" || extension === ".tsv") {
    return "table";
  }

  if (figureExtensions.has(extension)) {
    return "figure";
  }

  if (baseName.includes("config") || extension === ".yaml" || extension === ".yml") {
    return "config";
  }

  if (checkpointExtensions.has(extension)) {
    return "checkpoint";
  }

  if (datasetExtensions.has(extension) || baseName.includes("dataset")) {
    return "dataset";
  }

  if (extension === ".log") {
    return "log";
  }

  return "other";
}

function inferArtifactLabel(filePath: string) {
  return path.basename(filePath).replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
}

function inferMediaType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  const byExtension: Record<string, string> = {
    ".csv": "text/csv",
    ".gif": "image/gif",
    ".html": "text/html",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".json": "application/json",
    ".jsonl": "application/jsonl",
    ".log": "text/plain",
    ".md": "text/markdown",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".txt": "text/plain",
    ".webp": "image/webp",
    ".yaml": "application/yaml",
    ".yml": "application/yaml"
  };

  return byExtension[extension];
}

function assertArtifactKind(kind: string): asserts kind is RunArtifactKind {
  const allowed: RunArtifactKind[] = [
    "metrics",
    "figure",
    "report",
    "table",
    "config",
    "checkpoint",
    "dataset",
    "log",
    "other"
  ];

  if (!allowed.includes(kind as RunArtifactKind)) {
    throw new Error(`Invalid artifact kind: ${kind}. Expected one of: ${allowed.join(", ")}`);
  }
}

function splitLines(content: string) {
  return content.split(/\r?\n/);
}

function clampNumber(value: number | undefined, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.trunc(value)));
}
