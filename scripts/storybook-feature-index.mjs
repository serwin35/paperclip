import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const generatedRoot = "ui/storybook/generated";
export const sidebarLabel = title => title.replaceAll("/", ", ");

export function featureIndex(root) {
  const sections = [];
  let section;
  const seen = new Set();
  const source = readFileSync(path.join(root, "maps/feature-map/README.md"), "utf8");
  for (const line of source.split("\n")) {
    if (line.startsWith("### ")) {
      section = { title: line.slice(4), features: [] };
      sections.push(section);
    }
    const match = line.match(/^\| \[([^\]]+)\]\(\.\/([a-z0-9-]+)\.md\) \| (.*) \|$/);
    if (!match) {
      if (line.startsWith("| [")) throw new Error(`Unrecognized feature-map row: ${line}`);
      continue;
    }
    if (!section || seen.has(match[2])) throw new Error(`Invalid feature-map entry: ${line}`);
    const [, title, id, description] = match;
    seen.add(id);
    const recipe = readFileSync(path.join(root, `maps/feature-map/${id}.md`), "utf8");
    const body = recipe.split(/^## Sub-features\s*$/m)[1]?.split(/^## /m)[0];
    if (!body) throw new Error(`Missing sub-features: ${id}`);
    const capabilities = [];
    for (const row of body.trim().split("\n")) {
      const capability = row.match(/^- `([^`]+)`:\s*(.*)$/);
      if (capability) {
        const [, key, text] = capability;
        capabilities.push({ id: `${id}/${key}`, label: key.replaceAll("-", " ").replace(/^./, letter => letter.toUpperCase()), description: text });
      } else if (row.trim() && capabilities.length) {
        capabilities.at(-1).description += ` ${row.trim()}`;
      }
    }
    if (!capabilities.length || new Set(capabilities.map(item => item.id)).size !== capabilities.length) throw new Error(`Invalid sub-features: ${id}`);
    section.features.push({ id, title, description, capabilities });
  }
  const populated = sections.filter(item => item.features.length);
  if (!populated.length) throw new Error("Feature-map index has no feature families");
  for (const file of readdirSync(path.join(root, "maps/feature-map"))) {
    if (file.endsWith(".md") && file !== "README.md" && !seen.has(file.slice(0, -3))) throw new Error(`Feature recipe missing from index: ${file}`);
  }
  return { sections: populated };
}

export function featureOrder(index) {
  return ["Overview", ...index.sections.flatMap(section => [sidebarLabel(section.title),
    section.features.flatMap(feature => [sidebarLabel(feature.title), ["Overview", "*"]]),
  ]), "Foundations"];
}

export function featureArtifacts(index) {
  const outputs = new Map([
    [`${generatedRoot}/feature-index.json`, JSON.stringify(index, null, 2) + "\n"],
  ]);
  for (const section of index.sections) {
    for (const feature of section.features) {
      outputs.set(`${generatedRoot}/features/${feature.id}.stories.tsx`, [
        'import type { Meta, StoryObj } from "@storybook/react-vite";',
        'import { FeatureOverview } from "../../support/feature-map/FeatureOverview";',
        "",
        "const meta = {",
        `  id: ${JSON.stringify(`feature-map-${feature.id}`)},`,
        `  title: ${JSON.stringify(`${sidebarLabel(section.title)}/${sidebarLabel(feature.title)}/Overview`)},`,
        "  component: FeatureOverview,",
        `  args: { area: ${JSON.stringify(feature.id)} },`,
        '  tags: ["!autodocs"],',
        '  parameters: { layout: "fullscreen" },',
        "} satisfies Meta<typeof FeatureOverview>;",
        "export default meta;",
        "export const Overview: StoryObj<typeof meta> = {};",
        "",
      ].join("\n"));
    }
  }
  return outputs;
}

export function reconcileFeatureArtifacts(root, index, write = false) {
  const outputs = featureArtifacts(index);
  const errors = [];
  function inspect(directory) {
    if (!existsSync(path.join(root, directory))) return;
    for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) inspect(file);
      else if (!outputs.has(file)) errors.push(`Unexpected generated feature file: ${file}`);
    }
  }
  inspect(generatedRoot);
  if (errors.length) return errors;
  for (const [file, content] of outputs) {
    const destination = path.join(root, file);
    if (write) {
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, content);
    } else if (!existsSync(destination) || readFileSync(destination, "utf8") !== content) {
      errors.push(`${file}: generated feature index is stale; run storybook-catalog.mjs --write`);
    }
  }
  const previewFile = "ui/storybook/.storybook/preview.tsx";
  const previewPath = path.join(root, previewFile);
  const preview = readFileSync(previewPath, "utf8");
  const pattern = /(\bstorySort:\s*\{\s*order:\s*)([\s\S]*?)(,\s*\n\s*\},)/g;
  if ([...preview.matchAll(pattern)].length !== 1) throw new Error("Expected one inline storySort.order in preview.tsx");
  const order = JSON.stringify(featureOrder(index), null, 2)
    .replace(/("[^"]+",)\n\s+\[\n\s+"Overview",\n\s+"\*"\n\s+\]/g, '$1 ["Overview", "*"]')
    .replaceAll("\n", "\n        ");
  const updated = preview.replace(pattern, (_, before, value, after) => before + order + after);
  if (write) writeFileSync(previewPath, updated);
  else if (updated !== preview) errors.push(`${previewFile}: generated sidebar order is stale; run storybook-catalog.mjs --write`);
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const errors = reconcileFeatureArtifacts(root, featureIndex(root));
  if (errors.length) {
    errors.forEach(error => console.error(error));
    process.exitCode = 1;
  }
}
