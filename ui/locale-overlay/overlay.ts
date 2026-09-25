/**
 * Pure source rewrite: replaces overlay candidates that have a dictionary
 * translation and returns the new code with a source map. No Vite, no I/O —
 * the plugin, the scanner and the tests all go through this function.
 */
import { type Dictionary, lookupTranslation } from "./dictionary";
import { type Candidate, LineIndex, encodeTranslation, extractCandidates, isTranslatableFile } from "./extract";

export interface OverlaySourceMap {
  version: 3;
  file: string;
  sources: string[];
  sourcesContent: string[];
  names: string[];
  mappings: string;
}

export interface OverlayResult {
  code: string;
  map: OverlaySourceMap;
  replaced: Candidate[];
}

interface Piece {
  text: string;
  originalStart: number;
  originalEnd: number;
  copy: boolean;
}

/**
 * Rewrites one UI module. `relativePath` is POSIX and relative to the UI
 * package root (`src/pages/Issues.tsx`); it drives the denylist and the
 * file-scoped dictionary keys. Returns `null` when nothing changes.
 */
export function applyOverlay(
  source: string,
  relativePath: string,
  dictionary: Dictionary,
  sourceId = relativePath,
): OverlayResult | null {
  if (!isTranslatableFile(relativePath)) return null;

  const replaced: Candidate[] = [];
  const pieces: Piece[] = [];
  let cursor = 0;

  for (const candidate of extractCandidates(source, relativePath)) {
    const translation = lookupTranslation(dictionary, relativePath, candidate.text, candidate.context);
    if (!translation || candidate.start < cursor) continue;
    if (cursor < candidate.start) {
      pieces.push({ text: source.slice(cursor, candidate.start), originalStart: cursor, originalEnd: candidate.start, copy: true });
    }
    pieces.push({
      text: encodeTranslation(translation, candidate.encoding) + lineBreakPadding(source, candidate),
      originalStart: candidate.start,
      originalEnd: candidate.end,
      copy: false,
    });
    replaced.push(candidate);
    cursor = candidate.end;
  }

  if (replaced.length === 0) return null;
  if (cursor < source.length) {
    pieces.push({ text: source.slice(cursor), originalStart: cursor, originalEnd: source.length, copy: true });
  }

  return {
    code: pieces.map((piece) => piece.text).join(""),
    map: buildSourceMap(source, pieces, sourceId),
    replaced,
  };
}

/**
 * Keeps the line count of the module unchanged when a multi-line English
 * range becomes a single-line translation, so every following line keeps its
 * original line number. The padding is an empty JSX/JS comment: unlike
 * whitespace, it cannot change how JSX collapses the surrounding text.
 */
function lineBreakPadding(source: string, candidate: Candidate): string {
  const lineBreaks = countLineBreaks(source.slice(candidate.start, candidate.end));
  if (lineBreaks === 0) return "";
  const comment = `/*${"\n".repeat(lineBreaks)}*/`;
  return candidate.encoding === "jsx-text" ? `{${comment}}` : comment;
}

function countLineBreaks(value: string): number {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 10) count += 1;
  }
  return count;
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function encodeVlq(value: number): string {
  let remaining = value < 0 ? (-value << 1) | 1 : value << 1;
  let encoded = "";
  do {
    let digit = remaining & 31;
    remaining >>>= 5;
    if (remaining > 0) digit |= 32;
    encoded += BASE64[digit];
  } while (remaining > 0);
  return encoded;
}

const WORD_CHARACTER = /[\p{L}\p{N}_$]/u;

class MappingWriter {
  private readonly lines: string[][] = [[]];
  private generatedColumn = 0;
  private previousGeneratedColumn = 0;
  private previousOriginalLine = 0;
  private previousOriginalColumn = 0;

  /** Records that the current generated position comes from a 0-based original position. */
  segment(originalLine: number, originalColumn: number): void {
    this.lines[this.lines.length - 1].push(
      encodeVlq(this.generatedColumn - this.previousGeneratedColumn)
        + encodeVlq(0)
        + encodeVlq(originalLine - this.previousOriginalLine)
        + encodeVlq(originalColumn - this.previousOriginalColumn),
    );
    this.previousGeneratedColumn = this.generatedColumn;
    this.previousOriginalLine = originalLine;
    this.previousOriginalColumn = originalColumn;
  }

  advance(character: string): void {
    if (character === "\n") {
      this.lines.push([]);
      this.generatedColumn = 0;
      this.previousGeneratedColumn = 0;
    } else {
      this.generatedColumn += 1;
    }
  }

  toString(): string {
    return this.lines.map((segments) => segments.join(",")).join(";");
  }
}

/**
 * Copied text gets a segment at every line start and word boundary (the same
 * resolution as magic-string's `hires: "boundary"`); a translation maps as a
 * whole to the start of the English range it replaced.
 */
function buildSourceMap(source: string, pieces: readonly Piece[], sourceId: string): OverlaySourceMap {
  const lines = new LineIndex(source);
  const writer = new MappingWriter();
  const mapTo = (offset: number) => {
    const { line, column } = lines.position(offset);
    writer.segment(line - 1, column - 1);
  };

  for (const piece of pieces) {
    if (piece.copy) {
      for (let index = piece.originalStart; index < piece.originalEnd; index += 1) {
        const character = source[index];
        const previous = index > piece.originalStart ? source[index - 1] : undefined;
        if (
          previous === undefined
          || previous === "\n"
          || WORD_CHARACTER.test(character) !== WORD_CHARACTER.test(previous)
        ) {
          mapTo(index);
        }
        writer.advance(character);
      }
    } else {
      mapTo(piece.originalStart);
      // Index loop, not for-of: source map columns count UTF-16 code units.
      for (let index = 0; index < piece.text.length; index += 1) {
        const character = piece.text[index];
        writer.advance(character);
        if (character === "\n") mapTo(piece.originalStart);
      }
    }
  }

  return {
    version: 3,
    file: sourceId,
    sources: [sourceId],
    sourcesContent: [source],
    names: [],
    mappings: writer.toString(),
  };
}
