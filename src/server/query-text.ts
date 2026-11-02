const WORD = /[\p{Letter}\p{Number}]+/gu;
const MARK = /\p{Mark}/gu;
const MAX_QUERY_WORDS = 16;
const SNIPPET_LENGTH = 160;

/** Lowercase, without diacritics: `Café` and `cafe` fold the same. */
function fold(text: string): string {
  return text.normalize("NFKD").replace(MARK, "").toLowerCase();
}

/**
 * The terms the index stores for `text`: its folded words, separated by
 * spaces. Both dialects index these rather than the raw text, so SQLite
 * and Postgres split and fold words the same way, and the same way a
 * query is split.
 */
export function indexTerms(text: string): string {
  return (fold(text).match(WORD) ?? []).join(" ");
}

/**
 * The words of a user's query, folded like {@link indexTerms}. Everything
 * else, including every operator of FTS5 and `tsquery`, only separates
 * words, so no input can change the query's meaning or fail it.
 */
export function queryWords(text: string): string[] {
  return (fold(text).match(WORD) ?? []).slice(0, MAX_QUERY_WORDS);
}

/** An FTS5 `MATCH` expression: every word, the last also as a prefix. */
export function fts5Match(words: readonly string[]): string {
  return words
    .map((word, index) =>
      index === words.length - 1 ? `"${word}"*` : `"${word}"`,
    )
    .join(" AND ");
}

/** A `to_tsquery` expression: every word, the last also as a prefix. */
export function tsQuery(words: readonly string[]): string {
  return words
    .map((word, index) =>
      index === words.length - 1 ? `'${word}':*` : `'${word}'`,
    )
    .join(" & ");
}

/** `text` folded, with the offset in `text` of every folded code unit. */
function foldWithOffsets(text: string): {
  folded: string;
  offsets: number[];
} {
  let folded = "";
  const offsets: number[] = [];
  let at = 0;
  for (const char of text) {
    const part = fold(char);
    folded += part;
    for (let i = 0; i < part.length; i++) offsets.push(at);
    at += char.length;
  }
  return { folded, offsets };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function firstMatch(text: string, words: readonly string[]): number {
  const { folded, offsets } = foldWithOffsets(text);
  const last = words.length - 1;
  let best = -1;
  for (const [index, word] of words.entries()) {
    const end = index === last ? "" : "(?![\\p{Letter}\\p{Number}])";
    const pattern = new RegExp(
      `(?<![\\p{Letter}\\p{Number}])${escapeRegExp(word)}${end}`,
      "u",
    );
    const at = pattern.exec(folded)?.index;
    const offset = at === undefined ? undefined : offsets[at];
    if (offset !== undefined && (best < 0 || offset < best)) best = offset;
  }
  return best;
}

/**
 * Plain text of `text` around the first match of `words`, cut at word
 * boundaries and marked with `…` where it was cut; the start of the text
 * when nothing matches (the match was in the title).
 */
export function snippetOf(text: string, words: readonly string[]): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= SNIPPET_LENGTH) return flat;
  const at = Math.max(0, firstMatch(flat, words));
  let start = Math.max(0, at - SNIPPET_LENGTH / 4);
  if (start > 0) {
    const space = flat.indexOf(" ", start);
    start = space >= 0 && space < at ? space + 1 : start;
  }
  let end = Math.min(flat.length, start + SNIPPET_LENGTH);
  if (end < flat.length) {
    const space = flat.lastIndexOf(" ", end);
    end = space > at ? space : end;
  }
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}
