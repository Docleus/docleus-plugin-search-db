import {
  MAIN_BRANCH,
  PAGE_ENTRY_TYPE,
  REVISION_COMMITTED,
  SITE_PUBLISHED,
  type Context,
  type Entry,
  type LogEntry,
  type SearchDocument,
  z,
} from "@docleus/sdk";
import {
  MAIN_COLLECTION,
  SITE_COLLECTION_PREFIX,
  SITE_PAGES_FILE,
  siteCollection,
} from "../shared/index.ts";
import { parseSitePagesFile } from "./site-pages.ts";
import type { SearchStore } from "./store.ts";

/** Projection that keeps collection `main` at the head of every space's `main`. */
export const MAIN_PROJECTION = "search-db/main";
/** Projection that keeps one collection per site at its active publication. */
export const SITES_PROJECTION = "search-db/sites";

const CommittedSchema = z.object({
  spaceId: z.string(),
  revision: z.string(),
  branch: z.string().default(MAIN_BRANCH),
  changed: z.array(z.string()),
  removed: z.array(z.string()),
});

const PublishedSchema = z.object({
  siteId: z.string(),
  publication: z.string(),
});

/** The search document of a page entry. */
export function pageDocument(
  ctx: Context,
  spaceId: string,
  revision: string,
  entry: Entry,
  path?: string,
): SearchDocument {
  return {
    spaceId,
    entryId: entry.id,
    revision,
    title: entry.title,
    text: entry.body === undefined ? "" : ctx.blocks.text(entry.body),
    ...(path === undefined ? {} : { path }),
  };
}

/**
 * Registers the two projections that fill the index: `main` from every
 * commit to a space's `main`, and `site:<siteId>` from every
 * `site/published`, which replaces the site's collection with the pages of
 * the publication (a rollback is just another one).
 */
export function registerProjections(ctx: Context, store: SearchStore): void {
  const logger = ctx.logger("search-db");

  function invalid(entry: LogEntry): void {
    logger.warn("ignoring an invalid %s entry %d", entry.type, entry.seq);
  }

  ctx.content.registerProjection({
    name: MAIN_PROJECTION,
    reset: () => store.clear(MAIN_COLLECTION),
    async apply(entry) {
      if (entry.type !== REVISION_COMMITTED) return;
      const parsed = CommittedSchema.safeParse(entry.payload);
      if (!parsed.success) return invalid(entry);
      const commit = parsed.data;
      if (commit.branch !== MAIN_BRANCH) return;
      const documents: SearchDocument[] = [];
      const removed = [...commit.removed];
      for (const id of commit.changed) {
        const page = await ctx.content.getEntry(commit.revision, id);
        if (page?.type === PAGE_ENTRY_TYPE) {
          documents.push(
            pageDocument(ctx, commit.spaceId, commit.revision, page),
          );
        } else {
          removed.push(id);
        }
      }
      await store.remove(MAIN_COLLECTION, commit.spaceId, removed);
      await store.index(MAIN_COLLECTION, documents);
    },
  });

  ctx.content.registerProjection({
    name: SITES_PROJECTION,
    reset: () => store.clearPrefix(SITE_COLLECTION_PREFIX),
    async apply(entry) {
      if (entry.type !== SITE_PUBLISHED) return;
      const parsed = PublishedSchema.safeParse(entry.payload);
      if (!parsed.success) return invalid(entry);
      const published = parsed.data;
      const collection = siteCollection(published.siteId);
      const publication = await ctx.sites.getPublication(published.publication);
      // Gone with its site: nothing of it can be searched any more.
      if (publication?.siteId !== published.siteId) {
        return store.clear(collection);
      }
      const artifact = await ctx.sites.readArtifact(publication.artifact);
      const file = artifact.files[SITE_PAGES_FILE];
      const bytes = file && (await ctx.blobs.get(file.hash));
      // Published while search was not enabled for the site.
      if (!bytes) return store.clear(collection);
      const pages = parseSitePagesFile(bytes);
      if (!pages) {
        logger.warn("ignoring the invalid page list of %s", publication.id);
        return store.clear(collection);
      }
      const documents: SearchDocument[] = [];
      for (const [spaceId, revision] of Object.entries(publication.revisions)) {
        const entries = new Map(
          (await ctx.content.listEntries(revision)).map((item) => [
            item.id,
            item,
          ]),
        );
        for (const page of pages) {
          const found =
            page.spaceId === spaceId ? entries.get(page.entryId) : undefined;
          if (found) {
            documents.push(
              pageDocument(ctx, spaceId, revision, found, page.path),
            );
          }
        }
      }
      await store.replace(collection, documents);
    },
  });
}
