/**
 * Flat locale dictionary: `{ "English source": "Translation" }`.
 *
 * Keys containing `::` are file-scoped overrides, written as
 * `"src/pages/Foo.tsx::Open"` (path relative to the UI package root). Lookup
 * order is file-scoped first, then global. Grammar-dependent fragments
 * (`interpolated` candidates such as the text around `{count}`) only match
 * file-scoped keys, because a global translation of a sentence fragment is
 * almost always wrong in Polish word order or plural form.
 */
import fs from "node:fs";

import { type CandidateContext, normalizeText } from "./extract";

export const SCOPE_SEPARATOR = "::";

export interface Dictionary {
  readonly global: ReadonlyMap<string, string>;
  /** file path → (English → translation) */
  readonly scoped: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** Original keys as written in the file, for stale-key reporting. */
  readonly entries: ReadonlyArray<DictionaryEntry>;
}

export interface DictionaryEntry {
  key: string;
  file?: string;
  text: string;
  translation: string;
}

export function parseDictionaryKey(key: string): { file?: string; text: string } {
  const separator = key.indexOf(SCOPE_SEPARATOR);
  if (separator === -1) return { text: normalizeText(key) };
  return {
    file: key.slice(0, separator).trim(),
    text: normalizeText(key.slice(separator + SCOPE_SEPARATOR.length)),
  };
}

export function createDictionary(raw: unknown): Dictionary {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("locale dictionary must be a flat JSON object of strings");
  }
  const global = new Map<string, string>();
  const scoped = new Map<string, Map<string, string>>();
  const entries: DictionaryEntry[] = [];

  for (const [key, translation] of Object.entries(raw)) {
    if (typeof translation !== "string") {
      throw new Error(`locale dictionary value for ${JSON.stringify(key)} must be a string`);
    }
    const { file, text } = parseDictionaryKey(key);
    if (!text) throw new Error(`locale dictionary key ${JSON.stringify(key)} has no English text`);
    entries.push({ key, file, text, translation });
    if (file) {
      let fileEntries = scoped.get(file);
      if (!fileEntries) {
        fileEntries = new Map();
        scoped.set(file, fileEntries);
      }
      fileEntries.set(text, translation);
    } else {
      global.set(text, translation);
    }
  }
  return { global, scoped, entries };
}

export function loadDictionary(dictionaryPath: string): Dictionary {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(dictionaryPath, "utf8"));
  } catch (error) {
    throw new Error(`cannot read locale dictionary ${dictionaryPath}: ${(error as Error).message}`);
  }
  return createDictionary(raw);
}

/**
 * Resolves a translation for a candidate. Empty translations are treated as
 * "not translated yet" so a placeholder entry never blanks out the UI.
 */
export function lookupTranslation(
  dictionary: Dictionary,
  file: string,
  text: string,
  context: CandidateContext,
): string | undefined {
  const scopedTranslation = dictionary.scoped.get(file)?.get(text);
  if (scopedTranslation) return scopedTranslation;
  if (context === "interpolated") return undefined;
  return dictionary.global.get(text) || undefined;
}
