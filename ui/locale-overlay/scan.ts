/**
 * Coverage report for a locale dictionary, using the same extraction as the
 * Vite plugin.
 *
 *   node cli/node_modules/tsx/dist/cli.mjs ui/locale-overlay/scan.ts [--locale pl] [--json] [--top 50]
 *
 * `--json` prints a machine-readable report (consumed by translate.ts).
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { type Dictionary, loadDictionary, lookupTranslation } from "./dictionary";
import { type Candidate, type CandidateContext, extractCandidates, isTranslatableFile } from "./extract";
import { checkModuleOverrides } from "./module-overrides";
import { UI_ROOT, dictionaryPathFor, toPosix } from "./paths";

export interface Occurrence {
  file: string;
  line: number;
  element: string;
  attribute?: string;
  context: CandidateContext;
}

export interface UntranslatedString {
  text: string;
  occurrences: number;
  /** True when every occurrence sits next to dynamic values and needs a file-scoped key. */
  requiresScopedKey: boolean;
  locations: Occurrence[];
}

export interface ScanReport {
  locale: string;
  files: number;
  uniqueStrings: number;
  translatedUniqueStrings: number;
  occurrences: number;
  translatedOccurrences: number;
  untranslated: UntranslatedString[];
  staleKeys: string[];
  parseErrors: Array<{ file: string; message: string }>;
}

function listTsxFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") files.push(...listTsxFiles(fullPath));
    } else if (entry.name.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

export function scan(dictionary: Dictionary, locale: string, uiRoot = UI_ROOT): ScanReport {
  const byText = new Map<string, { translatedCount: number; locations: Occurrence[] }>();
  const seenScopedKeys = new Set<string>();
  const parseErrors: ScanReport["parseErrors"] = [];
  let files = 0;
  let occurrences = 0;
  let translatedOccurrences = 0;

  for (const fullPath of listTsxFiles(path.join(uiRoot, "src"))) {
    const relativePath = toPosix(path.relative(uiRoot, fullPath));
    if (!isTranslatableFile(relativePath)) continue;
    files += 1;

    let candidates: Candidate[];
    try {
      candidates = extractCandidates(fs.readFileSync(fullPath, "utf8"), relativePath);
    } catch (error) {
      parseErrors.push({ file: relativePath, message: (error as Error).message });
      continue;
    }

    for (const candidate of candidates) {
      occurrences += 1;
      seenScopedKeys.add(`${relativePath}\u0000${candidate.text}`);
      const translated = lookupTranslation(dictionary, relativePath, candidate.text, candidate.context) !== undefined;
      if (translated) translatedOccurrences += 1;
      let entry = byText.get(candidate.text);
      if (!entry) {
        entry = { translatedCount: 0, locations: [] };
        byText.set(candidate.text, entry);
      }
      if (translated) entry.translatedCount += 1;
      entry.locations.push({
        file: relativePath,
        line: candidate.line,
        element: candidate.element,
        attribute: candidate.attribute,
        context: candidate.context,
      });
    }
  }

  const untranslated: UntranslatedString[] = [];
  let translatedUniqueStrings = 0;
  for (const [text, entry] of byText) {
    if (entry.translatedCount === entry.locations.length) {
      translatedUniqueStrings += 1;
      continue;
    }
    untranslated.push({
      text,
      occurrences: entry.locations.length - entry.translatedCount,
      requiresScopedKey: entry.locations.every((location) => location.context === "interpolated"),
      locations: entry.locations,
    });
  }
  untranslated.sort((left, right) => right.occurrences - left.occurrences || left.text.localeCompare(right.text));

  const staleKeys = dictionary.entries
    .filter((entry) => (entry.file ? !seenScopedKeys.has(`${entry.file}\u0000${entry.text}`) : !byText.has(entry.text)))
    .map((entry) => entry.key);

  return {
    locale,
    files,
    uniqueStrings: byText.size,
    translatedUniqueStrings,
    occurrences,
    translatedOccurrences,
    untranslated,
    staleKeys,
    parseErrors,
  };
}

function percent(part: number, whole: number): string {
  return whole === 0 ? "0.0%" : `${((part / whole) * 100).toFixed(1)}%`;
}

function argumentValue(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

function main(argv: readonly string[]): number {
  const locale = argumentValue(argv, "--locale") ?? (process.env.PAPERCLIP_UI_LOCALE || "pl");
  const report = scan(loadDictionary(dictionaryPathFor(locale)), locale);

  if (argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }

  const top = Number(argumentValue(argv, "--top") ?? 40);
  console.log(`locale ${report.locale}: ${report.files} files`);
  console.log(
    `unique strings: ${report.translatedUniqueStrings}/${report.uniqueStrings} (${percent(report.translatedUniqueStrings, report.uniqueStrings)})`,
  );
  console.log(
    `occurrences:    ${report.translatedOccurrences}/${report.occurrences} (${percent(report.translatedOccurrences, report.occurrences)})`,
  );
  console.log(`\ntop ${Math.min(top, report.untranslated.length)} untranslated (of ${report.untranslated.length}):`);
  for (const item of report.untranslated.slice(0, top)) {
    const first = item.locations[0];
    const scopedNote = item.requiresScopedKey ? " [needs file-scoped key]" : "";
    console.log(`  ${String(item.occurrences).padStart(4)}  ${JSON.stringify(item.text)}  ${first.file}:${first.line}${scopedNote}`);
  }
  if (report.staleKeys.length > 0) {
    console.log(`\nstale dictionary keys (${report.staleKeys.length}):`);
    for (const key of report.staleKeys) console.log(`  ${JSON.stringify(key)}`);
  }
  const overrides = checkModuleOverrides(locale);
  if (overrides.length > 0) {
    console.log(`\nmodule overrides (${overrides.length}):`);
    for (const override of overrides) {
      console.log(`  ${override.problem ? "DRIFT" : "ok   "}  ${override.relativePath}${override.problem ? ` — ${override.problem}` : ""}`);
    }
  }
  if (report.parseErrors.length > 0) {
    console.log(`\nparse errors (${report.parseErrors.length}):`);
    for (const error of report.parseErrors) console.log(`  ${error.file}: ${error.message}`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
