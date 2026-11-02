import { describe, expect, it, vi } from "vitest";
import { createPaletteSearch, pageHref, searchPath } from "./palette.ts";

type Request = (path: string, init?: RequestInit) => Promise<Response>;

const context = {
  orgId: "o 1",
  spaceId: "s1",
  entryId: undefined,
  branch: "main",
  signal: new AbortController().signal,
};

describe("palette search", () => {
  it("builds the search and page URLs", () => {
    expect(searchPath("o 1", "s/1", "a&b")).toBe(
      "/api/orgs/o%201/search?q=a%26b&space=s%2F1",
    );
    expect(searchPath("o1", undefined, "x")).toBe("/api/orgs/o1/search?q=x");
    expect(pageHref("o1", "s1", "e 1")).toBe("/orgs/o1/spaces/s1/pages/e%201");
  });

  it("turns hits of the space into palette results", async () => {
    const request = vi.fn<Request>(() =>
      Promise.resolve(
        Response.json({
          hits: [
            {
              spaceId: "s1",
              entryId: "install",
              title: "Install",
              snippet: "Run the installer.",
            },
            { spaceId: "s1", entryId: "blank", title: "", snippet: "" },
          ],
        }),
      ),
    );
    const search = createPaletteSearch(request);
    expect(await search(" inst ", context)).toEqual([
      {
        id: "s1/install",
        label: "Install",
        detail: "Run the installer.",
        href: "/orgs/o%201/spaces/s1/pages/install",
      },
      {
        id: "s1/blank",
        label: "Untitled",
        href: "/orgs/o%201/spaces/s1/pages/blank",
      },
    ]);
    expect(request.mock.calls[0]?.[0]).toBe(searchPath("o 1", "s1", "inst"));
    expect(request.mock.calls[0]?.[1]?.signal).toBe(context.signal);
  });

  it("asks nothing for an empty query or outside an org", async () => {
    const request = vi.fn<Request>();
    const search = createPaletteSearch(request);
    expect(await search("  ", context)).toEqual([]);
    expect(await search("x", { ...context, orgId: undefined })).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects a failed or malformed answer", async () => {
    const failed = createPaletteSearch(() =>
      Promise.resolve(new Response("nope", { status: 500 })),
    );
    await expect(failed("x", context)).rejects.toMatchObject({
      code: "search-db/request-failed",
    });
    const malformed = createPaletteSearch(() =>
      Promise.resolve(Response.json({ hits: [{ title: 1 }] })),
    );
    await expect(malformed("x", context)).rejects.toMatchObject({
      code: "search-db/invalid-response",
    });
  });
});
