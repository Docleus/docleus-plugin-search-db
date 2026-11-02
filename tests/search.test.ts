import type { Site } from "@docleus/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { MAIN_PROJECTION, SITES_PROJECTION } from "../src/server/index.ts";
import { run } from "../src/server/sql.ts";
import type {
  InstanceSearchResponse,
  SiteSearchResponse,
} from "../src/shared/index.ts";
import { page, setUp, type Fixture } from "./instance.ts";

const fixtures: Fixture[] = [];

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.dispose();
});

async function boot(): Promise<Fixture> {
  const fixture = await setUp();
  fixtures.push(fixture);
  return fixture;
}

async function createSite(
  fixture: Fixture,
  spaceIds: readonly string[] = [fixture.spaceId],
): Promise<Site> {
  const { site } = await fixture.owner.json<{ site: Site }>(
    "POST",
    fixture.sites,
    {
      slug: "docs",
      name: "Docs",
      domain: "docs.example.com",
      spaces: spaceIds.map((spaceId, index) => ({
        spaceId,
        path: index === 0 ? "" : `s${index}`,
      })),
    },
  );
  return site;
}

async function publish(fixture: Fixture, site: Site): Promise<string> {
  const { publication } = await fixture.owner.json<{
    publication: { id: string };
  }>("POST", `${fixture.sites}/${site.id}/publications`);
  return publication.id;
}

async function siteSearch(
  fixture: Fixture,
  q: string,
  headers?: Record<string, string>,
): Promise<SiteSearchResponse> {
  const prefix = headers ? "" : "/sites/acme/docs";
  const response = await fixture.get(
    `${prefix}/_search?q=${encodeURIComponent(q)}`,
    headers,
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/json");
  return (await response.json()) as SiteSearchResponse;
}

const titles = (response: { hits: readonly { title: string }[] }) =>
  response.hits.map((hit) => hit.title);

function orgSearch(fixture: Fixture, query: string): string {
  return `/api/orgs/${fixture.orgId}/search?${query}`;
}

describe("site search", () => {
  it("finds published pages under /sites/ and on the custom domain", async () => {
    const fixture = await boot();
    await fixture.commit(fixture.spaceId, {
      put: {
        home: page("Home", 0, "Welcome to the docs."),
        install: page("Install", 1, "Install the command line tool."),
        configure: page("Configure", 2, "Configure the tool with a file."),
      },
    });
    const site = await createSite(fixture);
    expect(await siteSearch(fixture, "tool")).toEqual({ hits: [] });
    await publish(fixture, site);

    const found = await siteSearch(fixture, "tool");
    expect(titles(found).toSorted()).toEqual(["Configure", "Install"]);
    for (const hit of found.hits) {
      expect(hit.path.startsWith("/")).toBe(true);
      const served = await fixture.get(`/sites/acme/docs${hit.path}`);
      expect(served.status).toBe(200);
      expect(await served.text()).toContain(hit.title);
    }
    expect((await siteSearch(fixture, "comm")).hits).toEqual([
      expect.objectContaining({ title: "Install" }),
    ]);

    const onDomain = await siteSearch(fixture, "tool", {
      host: "docs.example.com",
    });
    expect(onDomain).toEqual(found);
  });

  it("serves only what is published, and follows a rollback", async () => {
    const fixture = await boot();
    await fixture.commit(fixture.spaceId, {
      put: { home: page("Home", 0, "Version one of the guide.") },
    });
    const site = await createSite(fixture);
    const first = await publish(fixture, site);

    await fixture.commit(fixture.spaceId, {
      put: {
        home: page("Home", 0, "Version two of the guide."),
        extra: page("Extra", 1, "Brand new material."),
      },
    });
    expect(titles(await siteSearch(fixture, "two"))).toEqual([]);
    expect(titles(await siteSearch(fixture, "one"))).toEqual(["Home"]);

    await publish(fixture, site);
    expect(titles(await siteSearch(fixture, "two"))).toEqual(["Home"]);
    expect(titles(await siteSearch(fixture, "material"))).toEqual(["Extra"]);
    expect(titles(await siteSearch(fixture, "one"))).toEqual([]);

    await fixture.owner.json("POST", `${fixture.sites}/${site.id}/activate`, {
      publication: first,
    });
    expect(titles(await siteSearch(fixture, "one"))).toEqual(["Home"]);
    expect(titles(await siteSearch(fixture, "two"))).toEqual([]);
    expect(titles(await siteSearch(fixture, "material"))).toEqual([]);
  });

  it("puts the search box in the header and its stylesheet in the head", async () => {
    const fixture = await boot();
    await fixture.commit(fixture.spaceId, {
      put: {
        home: page("Home", 0, "Hello."),
        guide: page("Guide", 1, "Hello."),
      },
    });
    await publish(fixture, await createSite(fixture));
    const home = await (await fixture.get("/sites/acme/docs/")).text();
    expect(home).toContain('data-docleus-search data-root="./"');
    expect(home).toMatch(
      /<link rel="stylesheet" href="\.\/_assets\/plugins\/[^"]+\/search\.css">/,
    );
    const guide = await (await fixture.get("/sites/acme/docs/guide/")).text();
    expect(guide).toContain('data-root="../"');
    const css = home.match(/href="\.\/(_assets\/plugins\/[^"]+\/search\.css)"/);
    const stylesheet = await fixture.get(`/sites/acme/docs/${css?.[1] ?? ""}`);
    expect(stylesheet.status).toBe(200);
  });

  it("leaves other site requests alone", async () => {
    const fixture = await boot();
    await fixture.commit(fixture.spaceId, {
      put: { home: page("Home", 0, "Hello.") },
    });
    await publish(fixture, await createSite(fixture));
    expect((await fixture.get("/sites/acme/docs/")).status).toBe(200);
    expect((await fixture.get("/sites/acme/docs/_search/x")).status).toBe(404);
  });
});

const spacesOf = (response: InstanceSearchResponse) =>
  response.hits.map((hit) => hit.spaceId).toSorted();

describe("instance search", () => {
  it("searches the head of main and skips other branches", async () => {
    const fixture = await boot();
    await fixture.commit(fixture.spaceId, {
      put: {
        home: page("Home", 0, "Getting started."),
        api: page("API", 1, "Endpoints and tokens."),
      },
    });
    await fixture.instance.ctx.content.createBranch({
      spaceId: fixture.spaceId,
      name: "draft",
    });
    await fixture.commit(fixture.spaceId, {
      branch: "draft",
      put: { secret: page("Secret", 2, "Unreleased tokens.") },
    });

    const result = await fixture.owner.json<InstanceSearchResponse>(
      "GET",
      orgSearch(fixture, "q=tokens"),
    );
    expect(result.hits).toEqual([
      {
        spaceId: fixture.spaceId,
        entryId: "api",
        title: "API",
        snippet: "Endpoints and tokens.",
      },
    ]);

    await fixture.commit(fixture.spaceId, {
      put: { api: page("API", 1, "Endpoints only.") },
    });
    expect(
      (
        await fixture.owner.json<InstanceSearchResponse>(
          "GET",
          orgSearch(fixture, "q=tokens"),
        )
      ).hits,
    ).toEqual([]);

    await fixture.commit(fixture.spaceId, { remove: ["home"] });
    expect(
      (
        await fixture.owner.json<InstanceSearchResponse>(
          "GET",
          orgSearch(fixture, "q=started"),
        )
      ).hits,
    ).toEqual([]);
  });

  it("searches only spaces the caller may read and search is enabled in", async () => {
    const fixture = await boot();
    const other = await fixture.createSpace("other");
    const disabled = await fixture.createSpace("disabled", false);
    for (const spaceId of [fixture.spaceId, other, disabled]) {
      await fixture.commit(spaceId, {
        put: { home: page("Home", 0, "Shared words.") },
      });
    }
    const all = await fixture.owner.json<InstanceSearchResponse>(
      "GET",
      orgSearch(fixture, "q=shared"),
    );
    expect(spacesOf(all)).toEqual([fixture.spaceId, other].toSorted());

    const viewer = await fixture.createUser("Vera", "viewer");
    const visible = await viewer.json<InstanceSearchResponse>(
      "GET",
      orgSearch(fixture, "q=shared"),
    );
    expect(spacesOf(visible)).toEqual([fixture.spaceId]);

    const one = await fixture.owner.json<InstanceSearchResponse>(
      "GET",
      orgSearch(fixture, `q=shared&space=${other}`),
    );
    expect(spacesOf(one)).toEqual([other]);

    const forbidden = await viewer.call(
      "GET",
      orgSearch(fixture, `q=shared&space=${other}`),
    );
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toMatchObject({ code: "search/forbidden" });
    const notEnabled = await fixture.owner.call(
      "GET",
      orgSearch(fixture, `q=shared&space=${disabled}`),
    );
    expect(notEnabled.status).toBe(404);
    expect(await notEnabled.json()).toMatchObject({
      code: "search/not-enabled",
    });
    const missingSpace = await fixture.owner.call(
      "GET",
      orgSearch(fixture, "q=shared&space=nope"),
    );
    expect(missingSpace.status).toBe(404);
    const missingOrg = await fixture.owner.call(
      "GET",
      "/api/orgs/nope/search?q=shared",
    );
    expect(missingOrg.status).toBe(404);
    const badLimit = await fixture.owner.call(
      "GET",
      orgSearch(fixture, "q=shared&limit=0"),
    );
    expect(badLimit.status).toBe(400);
    const limited = await fixture.owner.json<InstanceSearchResponse>(
      "GET",
      orgSearch(fixture, "q=shared&limit=1"),
    );
    expect(limited.hits).toHaveLength(1);
  });

  it("is a service other plugins can query", async () => {
    const fixture = await boot();
    await fixture.commit(fixture.spaceId, {
      put: { home: page("Home", 0, "Searchable text.") },
    });
    await fixture.instance.ctx.content.catchUp(MAIN_PROJECTION);
    const hits = await fixture.instance.ctx.search.query("main", {
      text: "searchable",
      spaceIds: [fixture.spaceId],
    });
    expect(hits.map((hit) => hit.entryId)).toEqual(["home"]);
  });
});

async function dumpIndex(fixture: Fixture): Promise<unknown[]> {
  const { storage } = fixture.instance.ctx;
  return run(
    storage.db,
    storage.dialect,
    "select collection, space_id, entry_id, revision, title, body, path from search_documents order by collection, space_id, entry_id",
  );
}

describe("rebuilding the index", () => {
  it("gives the same index as the incremental updates", async () => {
    const fixture = await boot();
    const { ctx } = fixture.instance;
    const other = await fixture.createSpace("other");
    await fixture.commit(fixture.spaceId, {
      put: {
        home: page("Home", 0, "First words."),
        guide: page("Guide", 1, "A guide to things."),
        old: page("Old", 2, "Soon gone."),
      },
    });
    await fixture.commit(other, {
      put: { home: page("Other home", 0, "Elsewhere.") },
    });
    const site = await createSite(fixture, [fixture.spaceId, other]);
    const first = await publish(fixture, site);
    await fixture.commit(fixture.spaceId, {
      put: { guide: page("Guide", 1, "A better guide.") },
      remove: ["old"],
    });
    await ctx.content.createBranch({ spaceId: fixture.spaceId, name: "wip" });
    await fixture.commit(fixture.spaceId, {
      branch: "wip",
      put: { draft: page("Draft", 3, "Not on main.") },
    });
    await publish(fixture, site);
    await fixture.owner.json("POST", `${fixture.sites}/${site.id}/activate`, {
      publication: first,
    });

    await ctx.content.catchUp(MAIN_PROJECTION);
    await ctx.content.catchUp(SITES_PROJECTION);
    const incremental = await dumpIndex(fixture);
    const before = {
      site: await siteSearch(fixture, "guide"),
      main: await fixture.owner.json<InstanceSearchResponse>(
        "GET",
        orgSearch(fixture, "q=guide"),
      ),
    };
    expect(incremental.length).toBeGreaterThan(0);

    await ctx.content.rebuild(MAIN_PROJECTION);
    await ctx.content.rebuild(SITES_PROJECTION);
    expect(await dumpIndex(fixture)).toEqual(incremental);
    expect(await siteSearch(fixture, "guide")).toEqual(before.site);
    expect(
      await fixture.owner.json<InstanceSearchResponse>(
        "GET",
        orgSearch(fixture, "q=guide"),
      ),
    ).toEqual(before.main);
  });
});
