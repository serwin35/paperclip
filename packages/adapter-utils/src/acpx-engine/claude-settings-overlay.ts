import fs from "node:fs/promises";
import path from "node:path";

export type ClaudeSettingsOverlayStatus = "absent" | "applied" | "invalid";

export interface ClaudeSettingsOverlayResult {
  settings: Record<string, unknown>;
  status: ClaudeSettingsOverlayStatus;
  added: number;
  skipped: number;
  reason?: string;
}

type OverlayEntry = { matcher: string; hooks: Array<Record<string, unknown>> };
type ParsedOverlay = { entries: OverlayEntry[]; dedupeCommandMarker?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOverlay(raw: string): ParsedOverlay {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || Object.keys(parsed).some((key) => !["hooks", "dedupeCommandMarker", "$comment"].includes(key))) {
    throw new Error("overlay must contain only hooks, dedupeCommandMarker, and optional $comment");
  }
  if (parsed.dedupeCommandMarker !== undefined && (typeof parsed.dedupeCommandMarker !== "string" || !parsed.dedupeCommandMarker)) throw new Error("dedupeCommandMarker must be a non-empty string");
  if (!isRecord(parsed.hooks) || Object.keys(parsed.hooks).some((key) => key !== "PreToolUse")) {
    throw new Error("hooks must contain only PreToolUse");
  }
  const entries = parsed.hooks.PreToolUse;
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("hooks.PreToolUse must be a non-empty array");
  const parsedEntries = entries.map((entry) => {
    if (!isRecord(entry) || Object.keys(entry).some((key) => key !== "matcher" && key !== "hooks")) {
      throw new Error("each entry must contain only matcher and hooks");
    }
    if (typeof entry.matcher !== "string" || !entry.matcher || !Array.isArray(entry.hooks) || !entry.hooks.length) {
      throw new Error("each entry requires a matcher and non-empty hooks array");
    }
    const hooks = entry.hooks.map((hook) => {
      if (!isRecord(hook) || Object.keys(hook).some((key) => !["type", "command", "timeout"].includes(key))) {
        throw new Error("each hook must contain only type, command, and optional timeout");
      }
      if (hook.type !== "command" || typeof hook.command !== "string" || !hook.command.trim()) throw new Error("hook type must be command and command must be non-empty");
      if (hook.timeout !== undefined && (typeof hook.timeout !== "number" || !Number.isFinite(hook.timeout) || hook.timeout <= 0)) throw new Error("hook timeout must be a positive number");
      return hook;
    });
    return { matcher: entry.matcher, hooks };
  });
  return { entries: parsedEntries, ...(typeof parsed.dedupeCommandMarker === "string" ? { dedupeCommandMarker: parsed.dedupeCommandMarker } : {}) };
}

export function mergeClaudeSettingsOverlay(existing: Record<string, unknown>, overlayRaw: string): ClaudeSettingsOverlayResult {
  let parsed: ParsedOverlay;
  try {
    parsed = parseOverlay(overlayRaw);
  } catch (error) {
    return { settings: existing, status: "invalid", added: 0, skipped: 0, reason: error instanceof Error ? error.message : String(error) };
  }
  const settings = structuredClone(existing);
  if (settings.hooks !== undefined && !isRecord(settings.hooks)) {
    return { settings: existing, status: "invalid", added: 0, skipped: parsed.entries.length, reason: "existing hooks must be an object" };
  }
  if (isRecord(settings.hooks) && settings.hooks.PreToolUse !== undefined && !Array.isArray(settings.hooks.PreToolUse)) {
    return { settings: existing, status: "invalid", added: 0, skipped: parsed.entries.length, reason: "existing hooks.PreToolUse must be an array" };
  }
  const hooks = isRecord(settings.hooks) ? { ...settings.hooks } : {};
  const current = Array.isArray(hooks.PreToolUse) ? [...hooks.PreToolUse] : [];
  let added = 0;
  let skipped = 0;
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
    return JSON.stringify(value);
  };
  for (const entry of parsed.entries) {
    const marker = parsed.dedupeCommandMarker;
    const entryHasMarker = marker && entry.hooks.some((hook) => typeof hook.command === "string" && hook.command.includes(marker));
    if (entryHasMarker && current.some((item) => isRecord(item) && item.matcher === entry.matcher && Array.isArray(item.hooks) && item.hooks.some((hook) => isRecord(hook) && typeof hook.command === "string" && hook.command.includes(marker)))) {
      skipped += 1;
      continue;
    }
    const candidate: OverlayEntry = { matcher: entry.matcher, hooks: entry.hooks };
    if (current.some((old) => canonical(old) === canonical(candidate))) skipped += 1;
    else { current.push(candidate); added += 1; }
  }
  if (added === 0) return { settings: existing, status: "applied", added, skipped };
  hooks.PreToolUse = current;
  settings.hooks = hooks;
  return { settings, status: "applied", added, skipped };
}

export async function readClaudeSettingsOverlay(companyRoot: string): Promise<{ status: "absent" } | { status: "present"; raw: string }> {
  try {
    return { status: "present", raw: await fs.readFile(path.join(companyRoot, "claude-settings-overlay.json"), "utf8") };
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return { status: "absent" };
    throw error;
  }
}
