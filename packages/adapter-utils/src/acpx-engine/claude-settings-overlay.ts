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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOverlay(raw: string): OverlayEntry[] {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || Object.keys(parsed).some((key) => key !== "hooks" && key !== "$comment")) {
    throw new Error("overlay must contain only hooks and optional $comment");
  }
  if (!isRecord(parsed.hooks) || Object.keys(parsed.hooks).some((key) => key !== "PreToolUse")) {
    throw new Error("hooks must contain only PreToolUse");
  }
  const entries = parsed.hooks.PreToolUse;
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("hooks.PreToolUse must be a non-empty array");
  return entries.map((entry) => {
    if (!isRecord(entry) || Object.keys(entry).some((key) => key !== "matcher" && key !== "hooks")) {
      throw new Error("each entry must contain only matcher and hooks");
    }
    if (typeof entry.matcher !== "string" || !entry.matcher || !Array.isArray(entry.hooks) || !entry.hooks.length) {
      throw new Error("each entry requires a matcher and non-empty hooks array");
    }
    const hooks = entry.hooks.map((hook) => {
      if (!isRecord(hook) || Object.keys(hook).some((key) => !["type", "command", "timeout", "dedupeCommandMarker"].includes(key))) {
        throw new Error("each hook must contain only type, command, timeout, and optional dedupeCommandMarker");
      }
      if (hook.type !== "command" || typeof hook.command !== "string" || !hook.command.trim()) throw new Error("hook type must be command and command must be non-empty");
      if (hook.timeout !== undefined && (typeof hook.timeout !== "number" || !Number.isFinite(hook.timeout) || hook.timeout <= 0)) throw new Error("hook timeout must be a positive number");
      if (hook.dedupeCommandMarker !== undefined && (typeof hook.dedupeCommandMarker !== "string" || !hook.dedupeCommandMarker)) throw new Error("dedupeCommandMarker must be a non-empty string");
      return hook;
    });
    return { matcher: entry.matcher, hooks };
  });
}

function withoutPrivateKeys(hook: Record<string, unknown>): Record<string, unknown> {
  const { dedupeCommandMarker: _marker, ...publicHook } = hook;
  return publicHook;
}

export function mergeClaudeSettingsOverlay(existing: Record<string, unknown>, overlayRaw: string): ClaudeSettingsOverlayResult {
  let entries: OverlayEntry[];
  try {
    entries = parseOverlay(overlayRaw);
  } catch (error) {
    return { settings: existing, status: "invalid", added: 0, skipped: 0, reason: error instanceof Error ? error.message : String(error) };
  }
  const settings = structuredClone(existing);
  if (settings.hooks !== undefined && !isRecord(settings.hooks)) {
    return { settings: existing, status: "invalid", added: 0, skipped: entries.length, reason: "existing hooks must be an object" };
  }
  if (isRecord(settings.hooks) && settings.hooks.PreToolUse !== undefined && !Array.isArray(settings.hooks.PreToolUse)) {
    return { settings: existing, status: "invalid", added: 0, skipped: entries.length, reason: "existing hooks.PreToolUse must be an array" };
  }
  const hooks = isRecord(settings.hooks) ? { ...settings.hooks } : {};
  const current = Array.isArray(hooks.PreToolUse) ? [...hooks.PreToolUse] : [];
  let added = 0;
  let skipped = 0;
  for (const entry of entries) {
    const markerHooks = entry.hooks.filter((hook) => typeof hook.dedupeCommandMarker === "string");
    const marker = markerHooks[0]?.dedupeCommandMarker as string | undefined;
    if (marker && current.some((item) => isRecord(item) && item.matcher === entry.matcher && Array.isArray(item.hooks) && item.hooks.some((hook) => isRecord(hook) && typeof hook.command === "string" && hook.command.includes(marker)))) {
      skipped += 1;
      continue;
    }
    const existingEntry = current.find((item) => isRecord(item) && item.matcher === entry.matcher && Array.isArray(item.hooks));
    const safeHooks = entry.hooks.map(withoutPrivateKeys);
    if (existingEntry && isRecord(existingEntry) && Array.isArray(existingEntry.hooks)) {
      const hooksList = [...existingEntry.hooks];
      for (let i = 0; i < safeHooks.length; i += 1) {
        const hook = safeHooks[i]!;
        if (hooksList.some((old) => JSON.stringify(old) === JSON.stringify(hook))) skipped += 1;
        else { hooksList.push(hook); added += 1; }
      }
      current[current.indexOf(existingEntry)] = { ...existingEntry, hooks: hooksList };
    } else {
      current.push({ matcher: entry.matcher, hooks: safeHooks });
      added += safeHooks.length;
    }
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
