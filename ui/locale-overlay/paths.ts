import path from "node:path";
import { fileURLToPath } from "node:url";

export const OVERLAY_DIR = path.dirname(fileURLToPath(import.meta.url));
/** The `ui/` package root; overlay paths and file-scoped keys are relative to it. */
export const UI_ROOT = path.resolve(OVERLAY_DIR, "..");

export function dictionaryPathFor(locale: string): string {
  if (!/^[a-z]{2,3}(-[A-Z]{2})?$/.test(locale)) throw new Error(`invalid locale ${JSON.stringify(locale)}`);
  return path.join(OVERLAY_DIR, `${locale}.json`);
}

export function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}
