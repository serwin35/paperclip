/**
 * Translation validation. The payload rules (matching `{{placeholders}}`, no
 * raw HTML / scripts / event handlers / `javascript:` / `data:`, no URLs that
 * are not in the English source, relative length cap) come straight from the
 * upstream `ui/src/i18n/locale-validation.ts`, so both localization paths
 * enforce exactly the same contract. Overlay-specific checks are added here.
 *
 *   node cli/node_modules/tsx/dist/cli.mjs ui/locale-overlay/validate.ts [--locale pl]
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { validateLocaleMessages } from "../src/i18n/locale-validation";
import { type Dictionary, loadDictionary } from "./dictionary";
import { isTranslatableFile } from "./extract";
import { checkModuleOverrides } from "./module-overrides";
import { UI_ROOT, dictionaryPathFor } from "./paths";

/** Returns human-readable problems with a single translation; empty when valid. */
export function validateTranslation(english: string, translation: string): string[] {
  const problems: string[] = [];
  if (translation.trim() === "") {
    problems.push("translation is empty (remove the key to leave the string in English)");
    return problems;
  }
  if (translation !== translation.trim()) problems.push("translation has leading or trailing whitespace");
  if (/[\r\n]/.test(translation) && !/[\r\n]/.test(english)) problems.push("translation contains a line break");

  const key = "value";
  for (const message of validateLocaleMessages({ [key]: translation }, { [key]: english })) {
    problems.push(message.startsWith(`${key} `) ? message.slice(key.length + 1) : message);
  }
  return problems;
}

export interface DictionaryIssue {
  key: string;
  problem: string;
}

export function validateDictionary(dictionary: Dictionary, uiRoot = UI_ROOT): DictionaryIssue[] {
  const issues: DictionaryIssue[] = [];
  for (const entry of dictionary.entries) {
    if (entry.file) {
      if (!isTranslatableFile(entry.file)) {
        issues.push({ key: entry.key, problem: `${entry.file} is not a translatable file (denylisted or not src/**/*.tsx)` });
      } else if (!fs.existsSync(path.join(uiRoot, entry.file))) {
        issues.push({ key: entry.key, problem: `${entry.file} does not exist` });
      }
    }
    for (const problem of validateTranslation(entry.text, entry.translation)) {
      issues.push({ key: entry.key, problem });
    }
  }
  return issues;
}

function parseLocaleArgument(argv: readonly string[]): string {
  const index = argv.indexOf("--locale");
  return index === -1 ? process.env.PAPERCLIP_UI_LOCALE || "pl" : argv[index + 1] ?? "";
}

function main(argv: readonly string[]): number {
  const locale = parseLocaleArgument(argv);
  const dictionaryPath = dictionaryPathFor(locale);
  const dictionary = loadDictionary(dictionaryPath);
  const issues = validateDictionary(dictionary);
  for (const override of checkModuleOverrides(locale)) {
    if (override.problem) issues.push({ key: `module:${override.relativePath}`, problem: override.problem });
  }
  for (const issue of issues) console.error(`${JSON.stringify(issue.key)}: ${issue.problem}`);
  const relativePath = path.relative(process.cwd(), dictionaryPath);
  if (issues.length > 0) {
    console.error(`\n${issues.length} problem(s) in ${relativePath}`);
    return 1;
  }
  console.log(`${relativePath}: ${dictionary.entries.length} entries valid`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
