import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { featureArtifacts, featureIndex, featureOrder, reconcileFeatureArtifacts } from "./storybook-feature-index.mjs";

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "storybook-feature-index-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, text) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  };
  write("maps/feature-map/README.md", "# Map\n### Work\n| [Tasks](./tasks.md) | Create and follow work. |\n| [Goals](./goals.md) | Align work. |\n### Connections\n| [Apps](./apps.md) | Connect tools. |\n");
  write("maps/feature-map/tasks.md", "# Tasks\n## Sub-features\n- `create`: Create work;\n  retain the initial description.\n- `review`: Review it.\n## How to get to it\nNot a capability.\n");
  write("maps/feature-map/goals.md", "# Goals\n## Sub-features\n- `hierarchy`: Link goals.\n## Gotchas\n");
  write("maps/feature-map/apps.md", "# Apps\n## Sub-features\n- `connect`: Connect an app.\n## Gotchas\n");
  write("ui/storybook/.storybook/preview.tsx", "export default { parameters: { options: { storySort: { order: [],\n}, unrelated: true } } };\n");
  return { root, write };
}

test("feature index preserves recipe names, map order, and multiline capability descriptions", t => {
  const { root } = fixture(t);
  const index = featureIndex(root);
  assert.deepEqual(index.sections.map(section => section.title), ["Work", "Connections"]);
  assert.deepEqual(index.sections.flatMap(section => section.features.map(feature => feature.id)), ["tasks", "goals", "apps"]);
  assert.deepEqual(index.sections[0].features[0].capabilities, [
    { id: "tasks/create", label: "Create", description: "Create work; retain the initial description." },
    { id: "tasks/review", label: "Review", description: "Review it." },
  ]);
  assert.deepEqual(featureOrder(index), ["Overview", "Work", ["Tasks", ["Overview", "*"], "Goals", ["Overview", "*"]], "Connections", ["Apps", ["Overview", "*"]], "Foundations"]);
});

test("every feature gets a stable overview, including features with no authored stories", t => {
  const { root } = fixture(t);
  const index = featureIndex(root);
  const outputs = featureArtifacts(index);
  const file = "ui/storybook/generated/features/goals.stories.tsx";
  assert.match(outputs.get(file), /id: "feature-map-goals"/);
  assert.match(outputs.get(file), /title: "Work\/Goals\/Overview"/);
  index.sections[0].features[1].title = "Work alignment";
  assert.match(featureArtifacts(index).get(file), /id: "feature-map-goals"/);
  assert.match(featureArtifacts(index).get(file), /title: "Work\/Work alignment\/Overview"/);
  index.sections[0].features[1].title = "CLI/API and local worktrees";
  assert.match(featureArtifacts(index).get(file), /title: "Work\/CLI, API and local worktrees\/Overview"/);
  assert.ok(featureOrder(index)[2].includes("CLI, API and local worktrees"));
});

test("generated guides detect upstream drift, local edits, missing files, and unknown files", t => {
  const { root, write } = fixture(t);
  const index = featureIndex(root);
  assert.equal(reconcileFeatureArtifacts(root, index).length, 5);
  assert.deepEqual(reconcileFeatureArtifacts(root, index, true), []);
  assert.deepEqual(reconcileFeatureArtifacts(root, index), []);
  write("ui/storybook/generated/features/goals.stories.tsx", "export default {};");
  assert.match(reconcileFeatureArtifacts(root, index).join("\n"), /goals.stories.tsx: generated feature index is stale/);
  reconcileFeatureArtifacts(root, index, true);
  index.sections.reverse();
  assert.match(reconcileFeatureArtifacts(root, index).join("\n"), /preview.tsx: generated sidebar order is stale/);
  assert.match(readFileSync(path.join(root, "ui/storybook/.storybook/preview.tsx"), "utf8"), /unrelated: true/);
  write("ui/storybook/generated/features/orphan.stories.tsx", "keep this visible");
  assert.match(reconcileFeatureArtifacts(root, index, true).join("\n"), /Unexpected generated feature file/);
  assert.equal(readFileSync(path.join(root, "ui/storybook/generated/features/orphan.stories.tsx"), "utf8"), "keep this visible");
});

test("malformed or omitted map entries fail instead of silently hiding a feature", t => {
  const { root, write } = fixture(t);
  write("maps/feature-map/README.md", "### Work\n| [Tasks](./tasks.md) | Tasks |\n");
  assert.throws(() => featureIndex(root), /missing from index/);
  write("maps/feature-map/README.md", "### Work\n| [Tasks](tasks.md) | Tasks |\n");
  assert.throws(() => featureIndex(root), /Unrecognized feature-map row/);
});
