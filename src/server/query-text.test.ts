import { describe, expect, it } from "vitest";
import {
  fts5Match,
  indexTerms,
  queryWords,
  snippetOf,
  tsQuery,
} from "./query-text.ts";

describe("queryWords", () => {
  it("folds case and diacritics and drops every operator", () => {
    expect(queryWords('Café "NEAR(x" -größe AND title:y*')).toEqual([
      "cafe",
      "near",
      "x",
      "große",
      "and",
      "title",
      "y",
    ]);
  });

  it("keeps at most 16 words", () => {
    expect(queryWords("a ".repeat(40))).toHaveLength(16);
  });
});

describe("indexTerms", () => {
  it("folds the same way as queries", () => {
    expect(indexTerms("Crème, BRÛLÉE!")).toBe("creme brulee");
  });
});

describe("match expressions", () => {
  it("quote every word and make the last a prefix", () => {
    expect(fts5Match(["run", "instal"])).toBe('"run" AND "instal"*');
    expect(tsQuery(["run", "instal"])).toBe("'run' & 'instal':*");
  });
});

describe("snippetOf", () => {
  it("returns short text whole, with whitespace collapsed", () => {
    expect(snippetOf("  a \n b  ", ["a"])).toBe("a b");
  });

  it("cuts long text around the first match at word boundaries", () => {
    const text = `${"lead ".repeat(80)}the Needle here ${"tail ".repeat(80)}`;
    const snippet = snippetOf(text, ["needle"]);
    expect(snippet).toContain("Needle");
    expect(snippet.startsWith("…lead ")).toBe(true);
    expect(snippet.endsWith(" tail…") || snippet.endsWith("tail…")).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(162);
  });

  it("finds a match whose text has diacritics the query lacks", () => {
    const text = `${"lead ".repeat(80)}un café noir ${"tail ".repeat(80)}`;
    expect(snippetOf(text, ["cafe"])).toContain("café");
  });

  it("starts at the beginning when only the title matched", () => {
    const text = `First words ${"x ".repeat(200)}`;
    expect(snippetOf(text, ["absent"]).startsWith("First words")).toBe(true);
  });
});
