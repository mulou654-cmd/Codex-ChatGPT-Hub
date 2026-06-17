import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { workspaceRoot } from "./config.js";

const execFileAsync = promisify(execFile);
const ignoredDirectories = new Set([
  ".git",
  ".data",
  "dist",
  "node_modules",
  ".next",
  ".turbo",
  "coverage",
  "build"
]);

const textExtensions = new Set([
  ".c",
  ".cc",
  ".css",
  ".go",
  ".h",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".py",
  ".rs",
  ".sh",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml"
]);

export interface WorkspaceSnapshotData {
  workspaceRoot: string;
  files: string[];
  branch?: string;
  gitStatus?: string;
}

export interface ReadWorkspaceFileOptions {
  path: string;
  startLine?: number;
  maxLines?: number;
}

export interface SearchWorkspaceOptions {
  query: string;
  maxResults?: number;
}

export async function collectWorkspaceSnapshot(maxFiles = 500): Promise<WorkspaceSnapshotData> {
  const files = await listWorkspaceFiles(maxFiles);
  const [branch, gitStatus] = await Promise.all([readGitBranch(), readGitStatus()]);

  return {
    workspaceRoot,
    files,
    branch,
    gitStatus
  };
}

export async function readWorkspaceFile(options: ReadWorkspaceFileOptions) {
  const absolutePath = resolveWorkspacePath(options.path);
  const extension = path.extname(absolutePath);

  if (extension && !textExtensions.has(extension)) {
    throw new Error(`Refusing to read non-text file: ${options.path}`);
  }

  const content = await readFile(absolutePath, "utf8");
  const lines = content.split(/\r?\n/);
  const startLine = Math.max(Math.trunc(options.startLine ?? 1), 1);
  const maxLines = Math.min(Math.max(Math.trunc(options.maxLines ?? 200), 1), 1000);
  const selectedLines = lines.slice(startLine - 1, startLine - 1 + maxLines);

  return {
    path: path.relative(workspaceRoot, absolutePath),
    startLine,
    endLine: startLine + selectedLines.length - 1,
    totalLines: lines.length,
    content: selectedLines.join("\n")
  };
}

export async function searchWorkspace(options: SearchWorkspaceOptions) {
  const maxResults = Math.min(Math.max(Math.trunc(options.maxResults ?? 50), 1), 200);
  const rgResult = await execFileAsync("rg", ["--line-number", "--column", "--no-heading", options.query, workspaceRoot], {
    maxBuffer: 1024 * 1024 * 10
  }).catch((error: unknown) => {
    if (isExecNoMatches(error)) {
      return { stdout: "" };
    }

    if (isCommandMissing(error)) {
      return { stdout: "", fallback: true };
    }

    throw error;
  });

  if ("fallback" in rgResult) {
    return searchWorkspaceWithNode(options.query, maxResults);
  }

  return rgResult.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(0, maxResults)
    .map(parseRipgrepLine);
}

async function searchWorkspaceWithNode(query: string, maxResults: number) {
  const files = await listWorkspaceFiles(5000);
  const needle = query.toLowerCase();
  const results: Array<{ file: string; line: number; column: number; text: string; engine: string }> = [];

  for (const file of files) {
    if (results.length >= maxResults) {
      break;
    }

    const absolutePath = resolveWorkspacePath(file);
    const extension = path.extname(absolutePath);
    if (extension && !textExtensions.has(extension)) {
      continue;
    }

    const content = await readFile(absolutePath, "utf8").catch(() => undefined);
    if (!content) {
      continue;
    }

    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length && results.length < maxResults; index += 1) {
      const line = lines[index] ?? "";
      const column = line.toLowerCase().indexOf(needle);
      if (column === -1) {
        continue;
      }

      results.push({
        file,
        line: index + 1,
        column: column + 1,
        text: line,
        engine: "node-fallback"
      });
    }
  }

  return results;
}

async function listWorkspaceFiles(maxFiles: number) {
  const files: string[] = [];

  async function walk(directory: string) {
    if (files.length >= maxFiles) {
      return;
    }

    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      if (files.length >= maxFiles) {
        return;
      }

      if (entry.name.startsWith(".") && entry.name !== ".env.example" && entry.name !== ".gitignore") {
        if (entry.name !== ".github") {
          continue;
        }
      }

      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(workspaceRoot, absolutePath);

      if (entry.isDirectory()) {
        if (ignoredDirectories.has(entry.name)) {
          continue;
        }

        await walk(absolutePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  }

  await walk(workspaceRoot);
  return files.sort();
}

async function readGitBranch() {
  const { stdout } = await execGit(["branch", "--show-current"]).catch(() => ({ stdout: "" }));
  return stdout.trim() || undefined;
}

async function readGitStatus() {
  const { stdout } = await execGit(["status", "--short"]).catch(() => ({ stdout: "" }));
  return stdout.trim() || undefined;
}

async function execGit(args: string[]) {
  return execFileAsync("git", args, {
    cwd: workspaceRoot,
    maxBuffer: 1024 * 1024 * 2
  });
}

function resolveWorkspacePath(inputPath: string) {
  const normalizedPath = inputPath.startsWith("/") ? inputPath : path.join(workspaceRoot, inputPath);
  const absolutePath = path.resolve(normalizedPath);

  if (absolutePath !== workspaceRoot && !absolutePath.startsWith(`${workspaceRoot}${path.sep}`)) {
    throw new Error(`Path is outside workspace: ${inputPath}`);
  }

  return absolutePath;
}

function parseRipgrepLine(line: string) {
  const [file = "", lineNumber = "", column = "", ...textParts] = line.split(":");
  return {
    file: path.relative(workspaceRoot, file),
    line: Number.parseInt(lineNumber, 10),
    column: Number.parseInt(column, 10),
    text: textParts.join(":")
  };
}

function isExecNoMatches(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 1
  );
}

function isCommandMissing(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
