import { PAGE_ENTRY_TYPE, type SitePage } from "@docleus/sdk";
import { describe, expect, it } from "vitest";
import { searchForm } from "./site.ts";
import { parseSitePagesFile, sitePagesFile } from "./site-pages.ts";

function sitePage(
  path: string,
  entryId: string | undefined,
  kind: SitePage["kind"] = "page",
): SitePage {
  const depth = path.split("/").filter((part) => part !== "").length;
  const rel = depth === 0 ? "./" : "../".repeat(depth);
  return {
    kind,
    site: { id: "site1", name: "Docs", settings: undefined },
    space: { id: "space1", orgId: "org1", slug: "docs", name: "Docs" },
    revision: "rev1",
    entry:
      entryId === undefined
        ? undefined
        : {
            id: entryId,
            type: PAGE_ENTRY_TYPE,
            title: entryId,
            parent: undefined,
            order: 0,
            fields: {},
          },
    path,
    title: entryId ?? "Not found",
    nav: [],
    prev: undefined,
    next: undefined,
    url: (target) => `${rel}${target.slice(1)}`,
    asset: (_plugin, file) => `${rel}_assets/${file}`,
  };
}

const encode = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));

describe("site page list", () => {
  it("records every page with an entry and reads back the same", () => {
    const file = sitePagesFile({
      site: { id: "site1", name: "Docs", settings: undefined },
      pages: [
        sitePage("/", "home"),
        sitePage("/guide/", "guide"),
        sitePage("/404/", undefined, "not-found"),
      ],
    });
    expect(file.type).toBe("application/json; charset=utf-8");
    const body =
      typeof file.body === "string"
        ? new TextEncoder().encode(file.body)
        : file.body;
    expect(parseSitePagesFile(body)).toEqual([
      { spaceId: "space1", entryId: "home", path: "/" },
      { spaceId: "space1", entryId: "guide", path: "/guide/" },
    ]);
  });

  it("rejects malformed lists", () => {
    const page = { spaceId: "s", entryId: "e", path: "/" };
    expect(parseSitePagesFile(new TextEncoder().encode("{"))).toBeUndefined();
    expect(parseSitePagesFile(encode(null))).toBeUndefined();
    expect(parseSitePagesFile(encode({ format: 2, pages: [page] }))).toBe(
      undefined,
    );
    expect(parseSitePagesFile(encode({ format: 1 }))).toBeUndefined();
    expect(
      parseSitePagesFile(
        encode({ format: 1, pages: [{ ...page, path: "x" }] }),
      ),
    ).toBeUndefined();
    expect(
      parseSitePagesFile(
        encode({ format: 1, pages: [{ ...page, entryId: 1 }] }),
      ),
    ).toBeUndefined();
    expect(parseSitePagesFile(encode({ format: 1, pages: [page] }))).toEqual([
      page,
    ]);
  });
});

describe("search form", () => {
  it("points at the site root relative to the page and starts hidden", () => {
    expect(searchForm(sitePage("/", "home"))).toContain(
      'data-docleus-search data-root="./" hidden>',
    );
    expect(searchForm(sitePage("/a/b/", "b"))).toContain('data-root="../../"');
  });
});
