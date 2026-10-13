# Storybook map

The [feature index](INDEX.md) connects the existing Storybook to stable capability
IDs from the upstream [feature map](../feature-map/README.md). Story files remain
in `ui/storybook/`. The feature map and its maintenance skill do not depend on
this catalog. New capabilities or upstream recipe drift are reported to their
maintainer; this catalog does not redefine product behavior or permissions.

## Ownership

- [maintain-storybook](../../.agents/skills/maintain-storybook/SKILL.md) owns story
  alignment, fixture corrections, classification, and this catalog.
- [review-storybook](../../.agents/skills/review-storybook/SKILL.md) consumes it to
  select and exercise examples, then reports evidence and drift.
- [DESIGN.md](../../DESIGN.md) governs design. Production verification remains
  with the existing product recipes and verification tools.

## Catalog contract

`catalog.json` is the maintained inventory, with one entry per authored story file.
`INDEX.md` is generated from it, the upstream feature map, and the installed Storybook CSF parser. Titles,
export filtering, story counts and IDs come from source, not filename guesses.
All examples are retained, including historical suites. A file's first capability
is its primary home; remaining capabilities are lookup references, not copies.
Foundations/guides and proposals without a mapped capability need an exception
reason. An absent story is not automatically a feature gap.

## Folders and sidebar

Story files live in `ui/storybook/stories/<primary-feature-area>/`, using the first
capability's area slug. Related capabilities still point to the same story. Shared
fixture modules and assets live in `ui/storybook/support/`; production wrappers in
`ui/storybook/prototypes/` retain their existing ownership.

The sidebar follows the section and feature names in the feature-map README, then
retains each suite's useful scenario grouping. Foundations contains shared component
examples with no primary product capability. Overview contains the catalog guide.
Every indexed feature has an Overview page, even when it has no cataloged examples.
The main guide and these pages use the same section, feature, and capability order
as the upstream map. Related suite links cross primary homes without copying stories.
Sidebar labels replace `/` with `, ` because Storybook treats slashes as folders;
the index and page heading retain the original feature name.
Missing examples are explicit; historical examples and guides do not imply current
behavioral coverage.

`ui/storybook/generated/` contains the derived index and one CSF Overview per
feature. The inline `storySort.order` in the preview config is also generated:
Storybook's indexer requires a literal there. Regenerate these outputs with the catalog command; do not edit
them or add them to the authored inventory. Their stable IDs use
`feature-map-<area>--overview`. Generated pages are explanatory guides and do not
increase example-suite counts. Storybook start/build checks this output for drift.
The generator fails on unexpected files rather than silently deleting them.

Each suite declares an explicit CSF `id`, recorded as `stableId` in the catalog.
The `sidebarTitle` can change without changing that identity. Existing story and
autodocs URLs and screenshot names remain valid. Do not derive a replacement ID
from a newly organized title. The checker rejects missing or changed explicit IDs,
incorrect feature folders, and sidebar titles outside their primary feature home.

Each entry records purpose, capability references, review sources/date/fingerprint,
notes, and three independent dimensions:

| Dimension | Values |
| --- | --- |
| Product status | `current`: source comparison supports the named subject; `proposed`: intentional alternate design; `historical`: superseded reference retained for its original purpose; `mixed`: suite combines these; `unreviewed`: parity has not been established |
| Implementation | `production`: shipped subject with fixture/layout wrappers; `prototype`: locally implemented subject, even if it uses shared primitives; `mixed`: both subjects; `guide`: explanatory documentation |
| Data boundary | `fixtures`: props, callbacks, caches or API responses are simulated; `fixture-server`: requires a separately owned local API/database fixture with simulated upstream providers; `static`: explanatory/static examples |

`current` is a source-review classification, not a promise that every state renders
or that APIs, gates, persistence and providers passed live tests. `unreviewed`
entries still have an inventory/classification review; notes explain the deeper
parity work outstanding. Mixed files retain a note naming the important split.
Production components can legitimately use mock data. A prototype directory name
does not establish implementation: some wrappers there re-export shipped UI.

Review sources include the story, relevant local support and production subjects.
Include directly rendered subjects regardless of import spelling, and primitives
when the suite demonstrates them. Do not truncate the list to a fixed source count.
Fingerprints make changes to those declared dependencies visible. They do not
follow every transitive production import or infer semantic correctness. Shared
preview/config/fixture changes have a separate fingerprint and require reviewing
affected callers. Update fingerprints only after reviewing the change, and add
missing dependencies when discovered. Date/revision context for the initial pass
and executed evidence belong in [REVIEW.md](REVIEW.md).

## Maintenance commands

After installing workspace dependencies:

```sh
node scripts/storybook-catalog.mjs
node scripts/storybook-catalog.mjs --write
node --test scripts/storybook-catalog.test.mjs scripts/storybook-feature-index.test.mjs
```

The checker rejects unaccounted or deleted stories, invalid capability references,
duplicate entries/IDs, missing review sources, changed fingerprints and a stale
generated indexes and feature pages. `--write` only regenerates these outputs; it never refreshes review
fingerprints or blesses drift. Preserve IDs when changing titles or moving files;
compare the existing built Storybook index before and after such changes.
Feature outputs are regenerated before fingerprints are checked. If those writes
change a review source, the command fails with the affected review entries. Inspect
the generated change before updating those fingerprints and rerunning the command.

Use the existing [Storybook workflow](../../doc/DEVELOPING.md#storybook) for builds,
browser review, and visual tests. Report source inspection, rendering, `play`
assertions, visual comparisons and production acceptance separately. Do not publish
new visual baselines just to make catalog maintenance pass.
