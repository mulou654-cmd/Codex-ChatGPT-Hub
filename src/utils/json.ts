import { readFile } from "node:fs/promises";

export function stripUtf8Bom(value: string) {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

export function parseJson<T>(value: string): T {
  return JSON.parse(stripUtf8Bom(value)) as T;
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  return parseJson<T>(await readFile(filePath, "utf8"));
}
