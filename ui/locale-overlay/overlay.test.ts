import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { parseAst } from "vite";
import { describe, expect, it } from "vitest";

import { createDictionary } from "./dictionary";
import { checkModuleOverrides, sha256 } from "./module-overrides";
import { applyOverlay } from "./overlay";
import { UI_ROOT } from "./paths";
import { localeOverlay } from "./vite-plugin-locale-overlay";

const FILE = "src/components/Example.tsx";

const dictionary = createDictionary({
  "Save changes": "Zapisz zmiany",
  "Search tasks...": "Szukaj zadań...",
  Close: "Zamknij",
  Open: "Otwórz",
  Yes: "Tak",
  "Tasks by Status": "Zadania według statusu",
  "Curly {braces} & <angles>": "Nawiasy {klamrowe} & <ostre>",
  issues: "zadań (globalnie)",
  [`${FILE}::issues`]: "zadań",
  [`${FILE}::Close`]: "Zamknij panel",
});

function overlay(source: string, file = FILE) {
  return applyOverlay(source, file, dictionary);
}

function decodeVlqSegments(mappings: string): number[][][] {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  return mappings.split(";").map((line) =>
    line === ""
      ? []
      : line.split(",").map((segment) => {
          const values: number[] = [];
          let value = 0;
          let shift = 0;
          for (const character of segment) {
            const digit = alphabet.indexOf(character);
            value += (digit & 31) << shift;
            if (digit & 32) {
              shift += 5;
            } else {
              values.push(value & 1 ? -(value >> 1) : value >> 1);
              value = 0;
              shift = 0;
            }
          }
          return values;
        }),
  );
}

describe("applyOverlay", () => {
  it("replaces JSX text and keeps the surrounding whitespace", () => {
    const result = overlay(`export const A = () => <button>\n  Save changes\n</button>;`);
    expect(result?.code).toBe(`export const A = () => <button>\n  Zapisz zmiany\n</button>;`);
  });

  it("translates allowlisted attributes and leaves other attributes alone", () => {
    const source = `export const A = () => <input placeholder="Search tasks..." value="Close" data-label="Close" className="Open" />;`;
    const code = overlay(source)?.code ?? "";
    expect(code).toContain(`placeholder={"Szukaj zadań..."}`);
    expect(code).toContain(`value="Close"`);
    expect(code).toContain(`data-label="Close"`);
    expect(code).toContain(`className="Open"`);
  });

  it("prefers a file-scoped key over the global one", () => {
    const code = overlay(`export const A = () => <button aria-label="Close">x</button>;`)?.code;
    expect(code).toContain(`aria-label={"Zamknij panel"}`);
    const elsewhere = applyOverlay(`export const A = () => <button aria-label="Close">x</button>;`, "src/pages/Other.tsx", dictionary);
    expect(elsewhere?.code).toContain(`aria-label={"Zamknij"}`);
  });

  it("translates interpolated fragments only through file-scoped keys", () => {
    const source = `export const A = ({ n }: { n: number }) => <span>{n} issues</span>;`;
    expect(overlay(source)?.code).toContain(`{n} zadań</span>`);
    expect(applyOverlay(source, "src/pages/Other.tsx", dictionary)).toBeNull();
  });

  it("translates string branches rendered as JSX children", () => {
    const code = overlay(`export const A = ({ ok }: { ok: boolean }) => <p>{ok ? "Yes" : "Unknown"}</p>;`)?.code;
    expect(code).toContain(`{ok ? "Tak" : "Unknown"}`);
  });

  it("returns null when nothing in the module is in the dictionary", () => {
    expect(overlay(`export const A = () => <p>Nothing to see</p>;`)).toBeNull();
  });

  it.each([
    "src/api/client.tsx",
    "src/components/Example.test.tsx",
    "src/components/Example.stories.tsx",
    "src/components/AgentPromptEditor.tsx",
    "src/adapters/claude/ConfigFields.tsx",
    "src/lib/helpers.ts",
    "vite.config.tsx",
  ])("never rewrites denylisted file %s", (file) => {
    expect(applyOverlay(`export const A = () => <p>Save changes</p>;`, file, dictionary)).toBeNull();
  });

  it("skips subtrees whose component or variable name suggests prompts or instructions", () => {
    const source = [
      "function InstructionsPanel() { return <p>Save changes</p>; }",
      "const promptPreview = <p>Close</p>;",
      "export const A = () => <p>Open</p>;",
    ].join("\n");
    const code = overlay(source)?.code ?? "";
    expect(code).toContain("<p>Save changes</p>");
    expect(code).toContain("<p>Close</p>");
    expect(code).toContain("<p>Otwórz</p>");
  });

  it("does not touch form values, code or preformatted text", () => {
    const source = [
      "export const A = () => (",
      "  <div>",
      "    <select><option>Open</option><option value=\"open\">Open</option></select>",
      "    <code>Close</code>",
      "    <pre>Save changes</pre>",
      "    <textarea>Close</textarea>",
      "  </div>",
      ");",
    ].join("\n");
    const code = overlay(source)?.code ?? "";
    expect(code).toContain("<option>Open</option>");
    expect(code).toContain('<option value="open">Otwórz</option>');
    expect(code).toContain("<code>Close</code>");
    expect(code).toContain("<pre>Save changes</pre>");
    expect(code).toContain("<textarea>Close</textarea>");
  });

  it("escapes translations so the output is still valid TSX", () => {
    const source = `export const A = () => <p title="Curly {braces} & <angles>">Curly {"{"}braces{"}"} &amp; &lt;angles&gt;</p>;`;
    const code = overlay(`export const A = () => <p title="Curly {braces} & <angles>">x</p>;`)?.code ?? "";
    expect(code).toContain(`title={"Nawiasy {klamrowe} & <ostre>"}`);
    expect(() => parseAst(code, { lang: "tsx" })).not.toThrow();
    expect(() => parseAst(source, { lang: "tsx" })).not.toThrow();
  });

  it("keeps the line count when multi-line text becomes a single-line translation", () => {
    const source = [
      "export const A = () => (",
      "  <h2>",
      "    Tasks by",
      "    Status",
      "  </h2>",
      ");",
      "export const marker = 1;",
    ].join("\n");
    const result = overlay(source);
    const code = result?.code ?? "";
    expect(code.split("\n")).toHaveLength(source.split("\n").length);
    expect(code.split("\n")[6]).toBe("export const marker = 1;");
    expect(code).toContain("Zadania według statusu{/*\n*/}");
    expect(() => parseAst(code, { lang: "tsx" })).not.toThrow();
  });

  it("emits a source map whose lines match the output and point back to the original lines", () => {
    const source = [
      "export const A = () => <button>Save changes</button>;",
      "export const B = () => <p>unchanged</p>;",
    ].join("\n");
    const result = overlay(source);
    expect(result).not.toBeNull();
    const map = result!.map;
    expect(map.version).toBe(3);
    expect(map.sourcesContent).toEqual([source]);

    const lines = decodeVlqSegments(map.mappings);
    expect(lines).toHaveLength(result!.code.split("\n").length);

    // Walk the deltas and check the first segment of line 2 maps to original line 2, column 0.
    let originalLine = 0;
    let originalColumn = 0;
    for (const segment of lines[0]) {
      originalLine += segment[2];
      originalColumn += segment[3];
    }
    const [generatedColumn, , lineDelta, columnDelta] = lines[1][0];
    expect(generatedColumn).toBe(0);
    expect(originalLine + lineDelta).toBe(1);
    expect(originalColumn + columnDelta).toBe(0);
  });
});

describe("breadcrumb labels", () => {
  const crumbs = createDictionary({ Tasks: "Zadania", Settings: "Ustawienia" });

  it("translates string labels passed to setBreadcrumbs and leaves hrefs and dynamic labels alone", () => {
    const source = [
      "export function Page({ name }: { name: string }) {",
      "  const { setBreadcrumbs } = useBreadcrumbs();",
      "  useEffect(() => {",
      "    setBreadcrumbs([{ label: \"Tasks\", href: \"/Tasks\" }, { label: name }, { label: \"Settings\" }]);",
      "  }, [name]);",
      "  return null;",
      "}",
    ].join("\n");
    const code = applyOverlay(source, FILE, crumbs)?.code ?? "";
    expect(code).toContain('{ label: "Zadania", href: "/Tasks" }, { label: name }, { label: "Ustawienia" }');
  });

  it("ignores label properties outside setBreadcrumbs", () => {
    const source = `const options = [{ label: "Tasks", value: "tasks" }]; export const A = () => <p>{options.length}</p>;`;
    expect(applyOverlay(source, FILE, crumbs)).toBeNull();
  });
});

describe("module overrides", () => {
  function exportedNames(file: string): string[] {
    const program = parseAst(fs.readFileSync(file, "utf8"), { lang: "ts" }) as unknown as {
      body: Array<{ type: string; declaration?: { id?: { name: string }; declarations?: Array<{ id: { name: string } }> } }>;
    };
    return program.body
      .filter((node) => node.type === "ExportNamedDeclaration" && node.declaration)
      .flatMap((node) => node.declaration?.declarations?.map((d) => d.id.name) ?? [node.declaration?.id?.name ?? ""])
      .sort();
  }

  it("every Polish override matches its upstream hash and exports the same API", () => {
    const statuses = checkModuleOverrides("pl");
    expect(statuses.length).toBeGreaterThan(0);
    for (const status of statuses) {
      expect(status.problem, status.relativePath).toBeNull();
      expect(exportedNames(status.overridePath)).toEqual(exportedNames(path.join(UI_ROOT, status.relativePath)));
    }
  });

  it("reports drift when the upstream module changed", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "locale-overlay-"));
    try {
      const uiRoot = path.join(workspace, "ui");
      const overlayDir = path.join(uiRoot, "locale-overlay");
      fs.mkdirSync(path.join(uiRoot, "src/lib"), { recursive: true });
      fs.mkdirSync(path.join(overlayDir, "modules/pl/src/lib"), { recursive: true });
      fs.writeFileSync(path.join(uiRoot, "src/lib/format.ts"), "export const unit = 'h';\n");
      fs.writeFileSync(
        path.join(overlayDir, "modules/pl/src/lib/format.ts"),
        `// overlay-upstream-sha256: ${sha256("export const unit = 'h';\n")}\nexport const unit = 'godz.';\n`,
      );
      expect(checkModuleOverrides("pl", uiRoot, overlayDir)[0].problem).toBeNull();

      fs.writeFileSync(path.join(uiRoot, "src/lib/format.ts"), "export const unit = 'hours';\n");
      expect(checkModuleOverrides("pl", uiRoot, overlayDir)[0].problem).toMatch(/upstream changed/);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});

describe("localeOverlay plugin", () => {
  it("is inactive without a locale and for English", () => {
    for (const locale of ["", "en"]) {
      const plugin = localeOverlay({ locale });
      const apply = plugin.apply as () => boolean;
      expect(apply()).toBe(false);
    }
  });

  it("rejects malformed locale names instead of reading arbitrary files", () => {
    expect(() => localeOverlay({ locale: "../../etc/passwd" })).toThrow(/invalid locale/);
  });
});
