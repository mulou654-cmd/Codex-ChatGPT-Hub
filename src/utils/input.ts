export function readOptionalString(args: unknown, key: string): string | undefined {
  if (!isRecord(args)) {
    return undefined;
  }

  const value = args[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function readString(args: unknown, key: string): string {
  const value = readOptionalString(args, key);

  if (!value) {
    throw new Error(`Missing required string field: ${key}`);
  }

  return value;
}

export function readNumber(args: unknown, key: string): number | undefined {
  if (!isRecord(args)) {
    return undefined;
  }

  const value = args[key];

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  return undefined;
}

export function readBoolean(args: unknown, key: string): boolean | undefined {
  if (!isRecord(args)) {
    return undefined;
  }

  const value = args[key];
  return typeof value === "boolean" ? value : undefined;
}

export function readStringArray(args: unknown, key: string): string[] | undefined {
  if (!isRecord(args)) {
    return undefined;
  }

  const value = args[key];

  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

export function readObject(args: unknown, key: string): Record<string, unknown> | undefined {
  if (!isRecord(args)) {
    return undefined;
  }

  const value = args[key];
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
