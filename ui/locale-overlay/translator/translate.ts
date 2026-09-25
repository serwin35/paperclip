/**
 * Fills untranslated overlay strings through the Claude API and merges the
 * validated results into `<locale>.json`.
 *
 *   cd ui/locale-overlay/translator && npm ci
 *   ANTHROPIC_API_KEY=... npm run translate -- [--locale pl] [--max 300] [--dry-run]
 *
 * Only global keys are filled. Fragments that sit next to dynamic values
 * (`requiresScopedKey`) need a human-written, file-scoped key because the
 * Polish word order and plural form depend on the surrounding sentence.
 */
import fs from "node:fs";
import path from "node:path";

import Anthropic from "@anthropic-ai/sdk";

import { loadDictionary } from "../dictionary";
import { OVERLAY_DIR, dictionaryPathFor } from "../paths";
import { type UntranslatedString, scan } from "../scan";
import { validateTranslation } from "../validate";

const MODEL = process.env.LOCALE_TRANSLATOR_MODEL || "claude-opus-5";
const BATCH_SIZE = 60;
const LOCALE_NAMES: Readonly<Record<string, string>> = { pl: "Polish" };

interface Options {
  locale: string;
  max: number;
  dryRun: boolean;
}

interface BatchItem {
  id: number;
  source: string;
  context: string;
}

interface ModelTranslation {
  id: number;
  translation: string;
  skip: boolean;
}

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    translations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          translation: { type: "string" },
          skip: { type: "boolean" },
        },
        required: ["id", "translation", "skip"],
        additionalProperties: false,
      },
    },
  },
  required: ["translations"],
  additionalProperties: false,
} as const;

function parseOptions(argv: readonly string[]): Options {
  const value = (name: string) => {
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
  };
  const locale = value("--locale") ?? "pl";
  if (!LOCALE_NAMES[locale]) throw new Error(`no translator configuration for locale ${JSON.stringify(locale)}`);
  const max = Number(value("--max") ?? 300);
  if (!Number.isInteger(max) || max <= 0) throw new Error("--max must be a positive integer");
  return { locale, max, dryRun: argv.includes("--dry-run") };
}

/** Where and how the string is rendered, so the model can tell a button verb from a status noun. */
function describeContext(item: UntranslatedString): string {
  return item.locations
    .slice(0, 3)
    .map((location) => {
      const role = location.attribute ? `${location.element}[${location.attribute}]` : `<${location.element}>`;
      return `${role} in ${location.file}${location.context === "mixed" ? " (next to other elements)" : ""}`;
    })
    .join("; ");
}

function systemPrompt(localeName: string, glossary: string): string {
  return [
    `You translate the user interface of Paperclip, a control plane for AI-agent companies, from English to ${localeName}.`,
    "Every input string is visible UI copy: a button, label, heading, placeholder, tooltip or message.",
    "Follow the glossary below exactly; it overrides your own terminology preferences.",
    "Rules:",
    "- Keep every {{placeholder}}, URL, product name, code identifier and keyboard shortcut unchanged.",
    "- Keep the source's trailing punctuation and ellipsis character (\"...\" vs \"…\").",
    "- Match the UI register: imperative for actions, nouns for headings and labels, sentence case.",
    "- Use the context (element, attribute, file) to decide between verb and noun readings.",
    "- Set skip=true (with translation equal to the source) for strings that must stay as they are:",
    "  brand names, code, identifiers, single letters, or strings you cannot translate without more context.",
    "Return one entry per input id.",
    "",
    "<glossary>",
    glossary,
    "</glossary>",
  ].join("\n");
}

async function translateBatch(
  client: Anthropic,
  items: readonly BatchItem[],
  system: string,
): Promise<ModelTranslation[]> {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
    system,
    messages: [
      {
        role: "user",
        content: `Translate these UI strings. Input as JSON:\n${JSON.stringify(items, null, 2)}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error(`model refused the batch (${response.stop_details?.category ?? "no category"})`);
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("response hit max_tokens; lower BATCH_SIZE");
  }
  const text = response.content.find((block) => block.type === "text");
  if (!text || text.type !== "text") throw new Error("response has no text block");
  const parsed = JSON.parse(text.text) as { translations: ModelTranslation[] };
  return parsed.translations;
}

function writeDictionary(dictionaryPath: string, entries: Record<string, string>): void {
  const sorted = Object.fromEntries(Object.entries(entries).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)));
  fs.writeFileSync(dictionaryPath, `${JSON.stringify(sorted, null, 2)}\n`);
}

async function main(argv: readonly string[]): Promise<number> {
  const options = parseOptions(argv);
  const dictionaryPath = dictionaryPathFor(options.locale);
  const glossary = fs.readFileSync(path.join(OVERLAY_DIR, "GLOSSARY.md"), "utf8");
  const report = scan(loadDictionary(dictionaryPath), options.locale);

  const candidates = report.untranslated.filter((item) => !item.requiresScopedKey).slice(0, options.max);
  console.log(
    `${report.untranslated.length} untranslated strings; translating ${candidates.length} with ${MODEL}`
      + `${options.dryRun ? " (dry run)" : ""}`,
  );
  if (candidates.length === 0) return 0;

  const client = new Anthropic({ maxRetries: 4 });
  const system = systemPrompt(LOCALE_NAMES[options.locale], glossary);
  const accepted: Record<string, string> = {};
  const rejected: string[] = [];
  let skipped = 0;
  let failedBatches = 0;

  for (let offset = 0; offset < candidates.length; offset += BATCH_SIZE) {
    const batch = candidates.slice(offset, offset + BATCH_SIZE).map((item, index) => ({
      id: offset + index,
      source: item.text,
      context: describeContext(item),
    }));
    let results: ModelTranslation[];
    try {
      results = await translateBatch(client, batch, system);
    } catch (error) {
      // Typed SDK errors have already been retried by the client; a failed
      // batch just stays English until the next run.
      failedBatches += 1;
      const status = error instanceof Anthropic.APIError ? ` (HTTP ${error.status})` : "";
      console.error(`batch ${offset / BATCH_SIZE + 1} failed${status}: ${(error as Error).message}`);
      if (error instanceof Anthropic.AuthenticationError) break;
      continue;
    }

    const byId = new Map(batch.map((item) => [item.id, item]));
    for (const result of results) {
      const item = byId.get(result.id);
      if (!item) continue;
      if (result.skip) {
        skipped += 1;
        continue;
      }
      const problems = validateTranslation(item.source, result.translation);
      if (problems.length > 0) {
        rejected.push(`${JSON.stringify(item.source)} → ${JSON.stringify(result.translation)}: ${problems.join("; ")}`);
      } else {
        accepted[item.source] = result.translation;
      }
    }
    console.log(`batch ${offset / BATCH_SIZE + 1}: ${Object.keys(accepted).length} accepted so far`);
  }

  const summary = [
    `accepted: ${Object.keys(accepted).length}`,
    `skipped by model: ${skipped}`,
    `rejected by validation: ${rejected.length}`,
    `failed batches: ${failedBatches}`,
  ];
  console.log(summary.join("\n"));
  for (const line of rejected) console.warn(`rejected ${line}`);

  if (!options.dryRun && Object.keys(accepted).length > 0) {
    const current = JSON.parse(fs.readFileSync(dictionaryPath, "utf8")) as Record<string, string>;
    writeDictionary(dictionaryPath, { ...accepted, ...current });
    console.log(`updated ${path.relative(process.cwd(), dictionaryPath)}`);
  } else if (options.dryRun) {
    console.log(JSON.stringify(accepted, null, 2));
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Locale overlay (${options.locale})\n\n- ${summary.join("\n- ")}\n`);
  }
  return failedBatches > 0 && Object.keys(accepted).length === 0 ? 1 : 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  },
);
