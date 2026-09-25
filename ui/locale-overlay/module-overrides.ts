/**
 * Whole-module overrides for plain `.ts` UI helpers that build display text
 * in code (e.g. `src/lib/timeAgo.ts` → "5m ago"), which the JSX overlay
 * cannot reach.
 *
 * An override lives at `locale-overlay/modules/<locale>/<ui-relative path>`
 * and must start with `// overlay-upstream-sha256: <hash>` — the SHA-256 of
 * the upstream file it was written against. When upstream changes that file,
 * the hash no longer matches: the plugin then serves the upstream module
 * (English, but correct) and validate/scan report the drift so a human
 * re-ports the override.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { OVERLAY_DIR, UI_ROOT, toPosix } from "./paths";

const HASH_HEADER = /^\/\/ overlay-upstream-sha256: ([0-9a-f]{64})$/m;

export interface ModuleOverride {
  /** UI-relative path of the upstream module, e.g. `src/lib/timeAgo.ts`. */
  relativePath: string;
  overridePath: string;
  expectedUpstreamSha256?: string;
}

export interface ModuleOverrideStatus extends ModuleOverride {
  /** `null` when the override is safe to serve. */
  problem: string | null;
}

export function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function listFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
  });
}

export function listModuleOverrides(locale: string, overlayDir = OVERLAY_DIR): ModuleOverride[] {
  const root = path.join(overlayDir, "modules", locale);
  return listFiles(root)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .map((overridePath) => ({
      relativePath: toPosix(path.relative(root, overridePath)),
      overridePath,
      expectedUpstreamSha256: fs.readFileSync(overridePath, "utf8").match(HASH_HEADER)?.[1],
    }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export function checkModuleOverrides(locale: string, uiRoot = UI_ROOT, overlayDir = OVERLAY_DIR): ModuleOverrideStatus[] {
  return listModuleOverrides(locale, overlayDir).map((override) => {
    const upstreamPath = path.join(uiRoot, override.relativePath);
    let problem: string | null = null;
    if (!override.relativePath.startsWith("src/") || override.relativePath.endsWith(".tsx")) {
      problem = "overrides are only allowed for src/**/*.ts helpers";
    } else if (!fs.existsSync(upstreamPath)) {
      problem = "upstream module no longer exists";
    } else if (!override.expectedUpstreamSha256) {
      problem = "missing `// overlay-upstream-sha256: <hash>` header";
    } else {
      const actual = sha256(fs.readFileSync(upstreamPath, "utf8"));
      if (actual !== override.expectedUpstreamSha256) {
        problem = `upstream changed (now ${actual}); re-port the override and update its hash`;
      }
    }
    return { ...override, problem };
  });
}
