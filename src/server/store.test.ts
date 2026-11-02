import {
  runConformanceSuite,
  searchConformanceSuite,
} from "@docleus/conformance";
import type { SearchDocument } from "@docleus/sdk";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPostgresDatabase,
  openStorage,
  POSTGRES_URL,
} from "../../tests/storage.ts";
import { run } from "./sql.ts";
import { createSearchStore, type SearchStore } from "./store.ts";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup();
});

async function open(location?: string): Promise<SearchStore> {
  const { storage, close } = await openStorage(location);
  cleanups.push(close);
  return createSearchStore(storage);
}

async function openPostgres(): Promise<SearchStore> {
  const database = await createPostgresDatabase();
  cleanups.push(database.drop);
  return open(database.url);
}

const openSqlite = () => open();

function doc(entryId: string, text: string): SearchDocument {
  return { spaceId: "s1", entryId, revision: "r1", title: "Page", text };
}

function storeTests(openStore: () => Promise<SearchStore>): void {
  runConformanceSuite(searchConformanceSuite, openStore);

  it("replace swaps the whole collection", async () => {
    const store = await openStore();
    await store.index("site:a", [doc("old", "alpha")]);
    await store.replace("site:a", [doc("new", "alpha")]);
    const hits = await store.query("site:a", {
      text: "alpha",
      spaceIds: ["s1"],
    });
    expect(hits.map((hit) => hit.entryId)).toEqual(["new"]);
  });

  it("clearPrefix clears only collections with the prefix", async () => {
    const store = await openStore();
    await store.index("site:a", [doc("a", "alpha")]);
    await store.index("site:b", [doc("b", "alpha")]);
    await store.index("main", [doc("m", "alpha")]);
    await store.index("site_x", [doc("x", "alpha")]);
    await store.clearPrefix("site:");
    const query = { text: "alpha", spaceIds: ["s1"] };
    expect(await store.query("site:a", query)).toEqual([]);
    expect(await store.query("site:b", query)).toEqual([]);
    expect(await store.query("main", query)).toHaveLength(1);
    expect(await store.query("site_x", query)).toHaveLength(1);
  });

  it("diacritics and case fold the same in queries and documents", async () => {
    const store = await openStore();
    await store.index("main", [doc("a", "Crème brûlée à la CAFÉ")]);
    const ids = async (text: string) =>
      (await store.query("main", { text, spaceIds: ["s1"] })).map(
        (hit) => hit.entryId,
      );
    expect(await ids("creme brulee")).toEqual(["a"]);
    expect(await ids("cafe")).toEqual(["a"]);
    expect(await ids("Café")).toEqual(["a"]);
  });
}

describe("search store on SQLite", () => {
  storeTests(openSqlite);

  it("refuses a stored document that is malformed", async () => {
    const { storage, close } = await openStorage();
    cleanups.push(close);
    const store = createSearchStore(storage);
    await store.index("main", [doc("a", "alpha")]);
    // SQLite keeps a blob in a text column as it is.
    await run(storage.db, "sqlite", "update search_documents set path = x'00'");
    await expect(
      store.query("main", { text: "alpha", spaceIds: ["s1"] }),
    ).rejects.toMatchObject({ code: "search/invalid-row" });
  });
});

describe.skipIf(POSTGRES_URL === undefined)("search store on Postgres", () => {
  storeTests(openPostgres);
});
