/**
 * Candidate extraction shared by the Vite plugin, the scanner and the tests.
 *
 * A "candidate" is a user-visible English string in a `.tsx` file that the
 * overlay is allowed to replace: JSX text, a string value of an allowlisted
 * display attribute, or a plain string literal rendered directly as a JSX
 * child. Everything else (object literals, function arguments, API payloads,
 * non-display props) is ignored by construction, which is what keeps locale
 * strings display-only.
 */
import { parseAst } from "vite";

export type CandidateKind = "jsx-text" | "jsx-attribute" | "jsx-expression" | "breadcrumb-label";

/**
 * How a child string relates to its siblings:
 * - `standalone`: the only meaningful child of its element.
 * - `mixed`: shares the element with other elements (icons, links, badges).
 * - `interpolated`: shares the element with dynamic values (`{count} issues`).
 *   These are grammar-dependent fragments and only match file-scoped keys.
 */
export type CandidateContext = "standalone" | "mixed" | "interpolated";

/** How a translation is written back into source for a candidate range. */
export type CandidateEncoding = "jsx-text" | "jsx-attribute-value" | "js-string";

export interface Candidate {
  kind: CandidateKind;
  /** Normalized English text (entities decoded, whitespace collapsed); the dictionary key. */
  text: string;
  /** Replacement range in the original source, as UTF-16 offsets. */
  start: number;
  end: number;
  /** 1-based position of the range start. */
  line: number;
  column: number;
  /** Name of the enclosing JSX element (`<html>` elements are lowercase). */
  element: string;
  /** Attribute name for `jsx-attribute` candidates. */
  attribute?: string;
  context: CandidateContext;
  encoding: CandidateEncoding;
}

/** Attributes whose string values are display-only on every element. */
export const DISPLAY_ATTRIBUTES: ReadonlySet<string> = new Set([
  "placeholder",
  "title",
  "aria-label",
  "alt",
  "label",
  "description",
]);

/**
 * Extra attributes that are display-only on specific components. Each entry
 * was verified by reading the component: the prop is only rendered, never
 * sent to the API or used as a value.
 */
export const ELEMENT_DISPLAY_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  EmptyState: ["message"],
  InlineEntitySelector: ["emptyMessage", "searchPlaceholder"],
  SearchableSelect: ["emptyMessage"],
  AgentMultiSelect: ["emptyMessage"],
  Field: ["hint"],
  ToggleField: ["hint"],
  CommandGroup: ["heading"],
};

/**
 * Elements whose text content is either code, user data or a form value.
 * Their subtrees are never touched: `<option>` without `value` submits its
 * text, `<textarea>` children become its value, `<code>`/`<pre>` hold
 * commands and snippets meant to be copied verbatim.
 */
const SKIPPED_ELEMENTS: ReadonlySet<string> = new Set([
  "code",
  "pre",
  "kbd",
  "samp",
  "var",
  "script",
  "style",
  "textarea",
]);

/**
 * Identifiers (component, function or variable names) that suggest the
 * subtree renders or edits prompts, agent instructions, templates or adapter
 * config. Anything under such a name is skipped wholesale so locale strings
 * can never leak into content an agent reads.
 */
export const DENIED_IDENTIFIER_PATTERN = /prompt|instruction|template|adapterconfig|adapter_config/i;

/**
 * Files under `ui/` that must never be rewritten. Paths are POSIX, relative
 * to the UI package root (e.g. `src/pages/Issues.tsx`).
 */
const DENIED_PATH_PATTERNS: readonly RegExp[] = [
  /^src\/api\//,
  /\.(test|spec|stories)\.tsx$/,
  /(^|\/)(__tests__|__mocks__|fixtures|storybook)\//,
  /prompt|instruction|template/i,
  /adapter/i,
  /agent-?config/i,
];

/** Returns true when the overlay may rewrite this UI-relative path. */
export function isTranslatableFile(relativePath: string): boolean {
  if (!relativePath.startsWith("src/") || !relativePath.endsWith(".tsx")) return false;
  return !DENIED_PATH_PATTERNS.some((pattern) => pattern.test(relativePath));
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  middot: "·",
  bull: "•",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  larr: "←",
  rarr: "→",
  times: "×",
  copy: "©",
};

/** Decodes the HTML entities JSX supports in text and attribute strings. */
export function decodeJsxEntities(raw: string): string {
  return raw.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const codePoint = body[1] === "x" || body[1] === "X"
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
    }
    return NAMED_ENTITIES[body] ?? match;
  });
}

/** Normalizes English source text into a dictionary key. */
export function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** A string is worth translating when it contains at least one letter. */
function hasTranslatableContent(text: string): boolean {
  return /\p{L}/u.test(text);
}

interface AstNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

function isNode(value: unknown): value is AstNode {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

function jsxName(node: unknown): string {
  if (!isNode(node)) return "";
  switch (node.type) {
    case "JSXIdentifier":
      return String(node.name);
    case "JSXMemberExpression":
      return `${jsxName(node.object)}.${jsxName(node.property)}`;
    case "JSXNamespacedName":
      return `${jsxName(node.namespace)}:${jsxName(node.name)}`;
    default:
      return "";
  }
}

function declaredName(node: AstNode): string | undefined {
  switch (node.type) {
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ClassDeclaration":
    case "ClassExpression": {
      const id = node.id;
      return isNode(id) && id.type === "Identifier" ? String(id.name) : undefined;
    }
    case "VariableDeclarator": {
      const id = node.id;
      return isNode(id) && id.type === "Identifier" ? String(id.name) : undefined;
    }
    default:
      return undefined;
  }
}

function isStringLiteral(node: unknown): node is AstNode & { value: string } {
  return isNode(node) && node.type === "Literal" && typeof node.value === "string";
}

// Plain boolean, not a type predicate: `node is AstNode` would narrow the
// false branch to `never` for callers that already hold an AstNode.
function isStaticTemplate(node: unknown): boolean {
  return (
    isNode(node)
    && node.type === "TemplateLiteral"
    && Array.isArray(node.expressions)
    && node.expressions.length === 0
  );
}

function staticTemplateValue(node: AstNode): string | undefined {
  const quasis = node.quasis as Array<{ value: { cooked: string | null } }>;
  const cooked = quasis[0]?.value.cooked;
  return typeof cooked === "string" ? cooked : undefined;
}

/** Whitespace-only string children (`{" "}`) are JSX spacing, not content. */
function isWhitespaceLiteral(node: unknown): boolean {
  return isStringLiteral(node) && node.value.trim() === "";
}

function isJsxLike(node: unknown): boolean {
  return isNode(node) && (node.type === "JSXElement" || node.type === "JSXFragment");
}

/**
 * Does this JSX child render a dynamic value that could be text? Pure JSX
 * (`{cond && <Icon />}`, `{<Badge />}`) and comments don't count.
 */
function isDynamicTextChild(child: AstNode): boolean {
  if (child.type !== "JSXExpressionContainer") return false;
  const expression = child.expression;
  if (!isNode(expression) || expression.type === "JSXEmptyExpression") return false;
  return !rendersOnlyMarkupOrStrings(expression);
}

function rendersOnlyMarkupOrStrings(node: AstNode): boolean {
  if (isJsxLike(node) || isStringLiteral(node) || isStaticTemplate(node)) return true;
  if (node.type === "Literal" && node.value === null) return true;
  if (node.type === "ConditionalExpression") {
    return [node.consequent, node.alternate].every((branch) => isNode(branch) && rendersOnlyMarkupOrStrings(branch));
  }
  if (node.type === "LogicalExpression") {
    return isNode(node.right) && rendersOnlyMarkupOrStrings(node.right);
  }
  return false;
}

function isMeaningfulChild(child: AstNode): boolean {
  if (child.type === "JSXText") return String(child.value).trim() !== "";
  if (child.type === "JSXExpressionContainer") {
    const expression = child.expression;
    return isNode(expression) && expression.type !== "JSXEmptyExpression" && !isWhitespaceLiteral(expression);
  }
  return true;
}

function classifyChild(child: AstNode, siblings: readonly AstNode[]): CandidateContext {
  const others = siblings.filter((sibling) => sibling !== child && isMeaningfulChild(sibling));
  if (others.some(isDynamicTextChild)) return "interpolated";
  return others.length > 0 ? "mixed" : "standalone";
}

function hasAttribute(openingElement: AstNode, name: string): boolean {
  const attributes = openingElement.attributes as AstNode[];
  return attributes.some((attribute) => attribute.type === "JSXAttribute" && jsxName(attribute.name) === name);
}

function isAllowedAttribute(element: string, attribute: string): boolean {
  if (DISPLAY_ATTRIBUTES.has(attribute)) return true;
  return ELEMENT_DISPLAY_ATTRIBUTES[element]?.includes(attribute) ?? false;
}

/** Maps UTF-16 offsets to 1-based line and column positions. */
export class LineIndex {
  private readonly lineStarts: number[] = [0];

  constructor(source: string) {
    for (let index = 0; index < source.length; index += 1) {
      if (source.charCodeAt(index) === 10) this.lineStarts.push(index + 1);
    }
  }

  position(offset: number): { line: number; column: number } {
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (this.lineStarts[middle] <= offset) low = middle;
      else high = middle - 1;
    }
    return { line: low + 1, column: offset - this.lineStarts[low] + 1 };
  }
}

class CandidateCollector {
  readonly candidates: Candidate[] = [];
  private readonly lines: LineIndex;

  constructor(private readonly source: string) {
    this.lines = new LineIndex(source);
  }

  add(candidate: Omit<Candidate, "line" | "column">): void {
    if (!candidate.text || !hasTranslatableContent(candidate.text)) return;
    this.candidates.push({ ...candidate, ...this.lines.position(candidate.start) });
  }

  addJsxText(node: AstNode, element: string, context: CandidateContext): void {
    const raw = this.source.slice(node.start, node.end);
    const leading = raw.length - raw.trimStart().length;
    const trailing = raw.length - raw.trimEnd().length;
    if (leading === raw.length) return;
    this.add({
      kind: "jsx-text",
      text: normalizeText(decodeJsxEntities(raw)),
      start: node.start + leading,
      end: node.end - trailing,
      element,
      context,
      encoding: "jsx-text",
    });
  }

  /** Collects plain strings, including both branches of `cond ? "A" : "B"` and `cond && "A"`. */
  addStringExpression(
    node: unknown,
    base: Pick<Candidate, "kind" | "element" | "context"> & { attribute?: string },
  ): void {
    if (!isNode(node)) return;
    if (isStringLiteral(node)) {
      this.add({ ...base, text: normalizeText(node.value), start: node.start, end: node.end, encoding: "js-string" });
    } else if (isStaticTemplate(node)) {
      const value = staticTemplateValue(node);
      if (value !== undefined) {
        this.add({ ...base, text: normalizeText(value), start: node.start, end: node.end, encoding: "js-string" });
      }
    } else if (node.type === "ConditionalExpression") {
      this.addStringExpression(node.consequent, base);
      this.addStringExpression(node.alternate, base);
    } else if (node.type === "LogicalExpression") {
      this.addStringExpression(node.right, base);
    }
  }
}

function visitElement(node: AstNode, collector: CandidateCollector): void {
  const opening = node.openingElement as AstNode;
  const element = jsxName(opening.name);
  if (SKIPPED_ELEMENTS.has(element) || DENIED_IDENTIFIER_PATTERN.test(element)) return;
  // A native <option> without `value` submits its text content.
  if (element === "option" && !hasAttribute(opening, "value")) return;

  for (const attribute of opening.attributes as AstNode[]) {
    if (attribute.type !== "JSXAttribute") {
      visit(attribute, collector);
      continue;
    }
    const name = jsxName(attribute.name);
    const value = attribute.value;
    if (!isNode(value)) continue;
    if (isAllowedAttribute(element, name)) {
      if (isStringLiteral(value)) {
        collector.add({
          kind: "jsx-attribute",
          text: normalizeText(decodeJsxEntities(value.value)),
          start: value.start,
          end: value.end,
          element,
          attribute: name,
          context: "standalone",
          encoding: "jsx-attribute-value",
        });
        continue;
      }
      if (value.type === "JSXExpressionContainer") {
        collector.addStringExpression(value.expression, {
          kind: "jsx-attribute",
          element,
          attribute: name,
          context: "standalone",
        });
      }
    }
    // Attribute values can hold JSX (`icon={<Plus />}`, render props).
    visit(value, collector);
  }

  visitChildren(node.children as AstNode[], element, collector);
}

function visitChildren(children: AstNode[], element: string, collector: CandidateCollector): void {
  for (const child of children) {
    if (child.type === "JSXText") {
      collector.addJsxText(child, element, classifyChild(child, children));
    } else if (child.type === "JSXExpressionContainer") {
      collector.addStringExpression(child.expression, {
        kind: "jsx-expression",
        element,
        context: classifyChild(child, children),
      });
      visit(child.expression, collector);
    } else {
      visit(child, collector);
    }
  }
}

/** `setBreadcrumbs(...)` or `ctx.setBreadcrumbs(...)`: page headings and the document title. */
function isBreadcrumbCall(node: AstNode): boolean {
  if (node.type !== "CallExpression" || !isNode(node.callee)) return false;
  const callee = node.callee;
  if (callee.type === "Identifier") return callee.name === "setBreadcrumbs";
  return callee.type === "MemberExpression" && isNode(callee.property) && callee.property.name === "setBreadcrumbs";
}

/**
 * Collects the string `label` of every `{ label: "..." }` object passed to
 * `setBreadcrumbs`. Breadcrumb labels are display-only (heading, trail and
 * document title); `href` and every other property are left alone.
 */
function addBreadcrumbLabels(call: AstNode, collector: CandidateCollector): void {
  const queue: unknown[] = [...(call.arguments as unknown[])];
  while (queue.length > 0) {
    const item = queue.shift();
    if (!isNode(item)) continue;
    if (item.type === "ArrayExpression") {
      queue.push(...(item.elements as unknown[]));
    } else if (item.type === "ObjectExpression") {
      for (const property of item.properties as AstNode[]) {
        if (property.type !== "Property" || property.computed || !isNode(property.key)) continue;
        const key = property.key.type === "Identifier" ? property.key.name : property.key.value;
        if (key !== "label") continue;
        collector.addStringExpression(property.value, {
          kind: "breadcrumb-label",
          element: "setBreadcrumbs",
          context: "standalone",
        });
      }
    }
  }
}

function visit(node: unknown, collector: CandidateCollector): void {
  if (Array.isArray(node)) {
    for (const item of node) visit(item, collector);
    return;
  }
  if (!isNode(node)) return;

  const name = declaredName(node);
  if (name && DENIED_IDENTIFIER_PATTERN.test(name)) return;

  if (isBreadcrumbCall(node)) addBreadcrumbLabels(node, collector);

  if (node.type === "JSXElement") {
    visitElement(node, collector);
    return;
  }
  if (node.type === "JSXFragment") {
    visitChildren(node.children as AstNode[], "<>", collector);
    return;
  }

  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end") continue;
    const value = node[key];
    if (typeof value === "object" && value !== null) visit(value, collector);
  }
}

/**
 * Parses a TSX module and returns every overlay candidate in source order.
 * Throws when the source cannot be parsed; callers decide how loud to be.
 */
export function extractCandidates(source: string, filename = "module.tsx"): Candidate[] {
  const program = parseAst(source, { lang: "tsx" }, filename);
  const collector = new CandidateCollector(source);
  visit(program, collector);
  return collector.candidates.sort((left, right) => left.start - right.start);
}

const JSX_TEXT_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "{": "&#123;",
  "}": "&#125;",
};

/** Serializes a translation so it is valid in the candidate's source position. */
export function encodeTranslation(translation: string, encoding: CandidateEncoding): string {
  switch (encoding) {
    case "jsx-text":
      return translation.replace(/[&<>{}]/g, (character) => JSX_TEXT_ESCAPES[character]);
    case "jsx-attribute-value":
      return `{${JSON.stringify(translation)}}`;
    case "js-string":
      return JSON.stringify(translation);
  }
}
