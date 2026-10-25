import { describe, expect, it } from "vitest";
import { mergeClaudeSettingsOverlay } from "./claude-settings-overlay.js";

const hook = (command: string, extra: Record<string, unknown> = {}) => ({ type: "command", command, ...extra });
const overlay = (entries: unknown[]) => JSON.stringify({ hooks: { PreToolUse: entries } });
const entry = (matcher: string, hooks: unknown[], extra: Record<string, unknown> = {}) => ({ matcher, hooks, ...extra });

describe("Claude settings overlay", () => {
  it("adds hooks while preserving other settings and permissions", () => {
    const existing = { permissions: { allow: ["Read"] }, statusLine: { type: "command" }, hooks: { PostToolUse: [{ matcher: "*", hooks: [hook("audit")] }] } };
    const result = mergeClaudeSettingsOverlay(existing, JSON.stringify({ dedupeCommandMarker: "guard-marker", hooks: { PreToolUse: [entry("Bash", [hook("guard")])] } }));
    expect(result.status).toBe("applied");
    expect(result.added).toBe(1);
    expect(result.settings).toEqual({ ...existing, hooks: { ...existing.hooks, PreToolUse: [entry("Bash", [hook("guard")])] } });
  });

  it("does not duplicate an entry by marker or exact canonical equality", () => {
    const existing = { hooks: { PreToolUse: [entry("Bash", [hook("node guard-marker")])] } };
    const result = mergeClaudeSettingsOverlay(existing, JSON.stringify({
      dedupeCommandMarker: "guard-marker",
      hooks: { PreToolUse: [entry("Bash", [hook("node guard-marker")]), entry("Write", [hook("other")])] },
    }));
    expect(result.added).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it("is idempotent on a second merge", () => {
    const raw = overlay([entry("Bash", [hook("guard")])]);
    const first = mergeClaudeSettingsOverlay({}, raw);
    const second = mergeClaudeSettingsOverlay(first.settings, raw);
    expect(first.added).toBe(1);
    expect(second.added).toBe(0);
    expect(second.skipped).toBe(1);
    expect(second.settings).toEqual(first.settings);
  });

  it("appends an independent Bash entry and leaves unrelated entries unchanged", () => {
    const existing = { hooks: { PreToolUse: [entry("Bash", [hook("echo audit")]), entry("^mcp__paperclip-assigned__", [hook("node guard-marker")])] } };
    const result = mergeClaudeSettingsOverlay(existing, JSON.stringify({ dedupeCommandMarker: "guard-marker", hooks: { PreToolUse: [
      entry("Bash", [hook("node guard")]),
      entry("^mcp__paperclip-assigned__", [hook("node guard-marker")]),
    ] } }));
    expect(result.added).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.settings).toEqual({ hooks: { PreToolUse: [
      entry("Bash", [hook("echo audit")]),
      entry("^mcp__paperclip-assigned__", [hook("node guard-marker")]),
      entry("Bash", [hook("node guard")]),
    ] } });
  });

  it("preserves malformed existing PreToolUse shapes", () => {
    for (const hooks of [null, "x", { PreToolUse: {} }]) {
      const existing = { hooks };
      const result = mergeClaudeSettingsOverlay(existing, overlay([entry("Bash", [hook("guard")])]));
      expect(result.settings).toBe(existing);
      expect(result.status).toBe("invalid");
      expect(result.reason).toMatch(/existing hooks/);
    }
    const withMalformedEntries = { hooks: { PreToolUse: [null, "x", { matcher: "Bash" }] } };
    const result = mergeClaudeSettingsOverlay(withMalformedEntries, overlay([entry("Bash", [hook("guard")])]));
    expect((result.settings.hooks as Record<string, unknown>).PreToolUse).toEqual([null, "x", { matcher: "Bash" }, entry("Bash", [hook("guard")])]);
    expect(result.status).toBe("applied");
  });

  it("rejects unknown keys and malformed overlay without changing settings", () => {
    const existing = { hooks: { PostToolUse: [] } };
    for (const raw of [
      "{",
      JSON.stringify({ hooks: "x" }),
      JSON.stringify({ hooks: { Other: [] } }),
      overlay([{}]),
      overlay([entry("Bash", [hook("guard", { type: "prompt" })])]),
      overlay([entry("Bash", [hook("guard", { extra: true })])]),
      overlay([entry("Bash", [hook("guard", { dedupeCommandMarker: "" })])]),
      JSON.stringify({ dedupeCommandMarker: "", hooks: { PreToolUse: [entry("Bash", [hook("guard")])] } }),
      overlay([entry("Bash", [hook("guard")], { unknown: true })]),
    ]) {
      const result = mergeClaudeSettingsOverlay(existing, raw);
      expect(result.status).toBe("invalid");
      expect(result.settings).toBe(existing);
      expect(result.reason).toBeTruthy();
    }
  });

  it("does not write comment or dedupe metadata to settings", () => {
    const result = mergeClaudeSettingsOverlay({}, JSON.stringify({ $comment: "private note", dedupeCommandMarker: "guard-marker", hooks: { PreToolUse: [entry("Bash", [hook("guard-marker")])] } }));
    expect(result.status).toBe("applied");
    expect(JSON.stringify(result.settings)).not.toContain("$comment");
    expect(JSON.stringify(result.settings)).not.toContain("dedupeCommandMarker");
  });

  it("skips a duplicate entry later in the overlay", () => {
    const result = mergeClaudeSettingsOverlay({}, overlay([entry("Bash", [hook("one")]), entry("Bash", [hook("one")])]));
    expect(result.added).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it("skips strict profile entries when the marker is present for both matchers", () => {
    const marker = "/command-guard/guard.mjs";
    const strict = { hooks: { PreToolUse: [
      entry("Bash", [hook(`node ${marker} --strict`)]),
      entry("^mcp__paperclip-assigned__", [hook(`node ${marker} --strict`)]),
    ] } };
    const raw = JSON.stringify({ dedupeCommandMarker: marker, hooks: { PreToolUse: [
      entry("Bash", [hook(`node ${marker} --scope=agents`)]),
      entry("^mcp__paperclip-assigned__", [hook(`node ${marker} --scope=agents`)]),
    ] } });
    const result = mergeClaudeSettingsOverlay(strict, raw);
    expect(result.added).toBe(0);
    expect(result.skipped).toBe(2);
    expect(result.settings).toBe(strict);
  });

  it("skips only overlay entries that themselves contain the marker", () => {
    const marker = "/command-guard/guard.mjs";
    const existing = { hooks: { PreToolUse: [entry("Bash", [hook(`node ${marker} --strict`)])] } };
    const raw = JSON.stringify({ dedupeCommandMarker: marker, hooks: { PreToolUse: [
      entry("Bash", [hook(`node ${marker} --scope=agents`)]),
      entry("Bash", [hook("echo audit")]),
    ] } });
    const result = mergeClaudeSettingsOverlay(existing, raw);
    expect(result.added).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.settings).toEqual({ hooks: { PreToolUse: [
      entry("Bash", [hook(`node ${marker} --strict`)]),
      entry("Bash", [hook("echo audit")]),
    ] } });
  });

  it("compares hook entries canonically regardless of object key order", () => {
    const existing = { hooks: { PreToolUse: [entry("Bash", [{ command: "guard", type: "command", timeout: 20 }])] } };
    const result = mergeClaudeSettingsOverlay(existing, overlay([entry("Bash", [{ type: "command", command: "guard", timeout: 20 }])]));
    expect(result.added).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.settings).toBe(existing);
  });
});
