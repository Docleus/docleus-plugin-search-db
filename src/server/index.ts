import { definePlugin, type Context } from "@docleus/sdk";
import { PLUGIN_NAME } from "../shared/index.ts";
import { registerProjections } from "./projections.ts";
import { registerRoutes } from "./routes.ts";
import { registerSiteSearch } from "./site.ts";
import { createSearchStore } from "./store.ts";

export { MAIN_PROJECTION, SITES_PROJECTION } from "./projections.ts";
export { SEARCH_ROUTE } from "./routes.ts";
export { createSearchStore, type SearchStore } from "./store.ts";

/**
 * The search-db server plugin. Provides `search` on the instance database,
 * keeps collection `main` and one `site:<siteId>` collection per site up to
 * date through projections, serves `GET /api/orgs/:orgId/search`, and
 * answers `_search?q=` on published sites.
 *
 * @stability experimental
 */
export const plugin = definePlugin({
  name: PLUGIN_NAME,
  inject: [
    "storage",
    "content",
    "blocks",
    "blobs",
    "http",
    "authz",
    "installations",
    "render",
    "sites",
  ],
  provides: ["search"],
  apply(ctx: Context) {
    const logger = ctx.logger("search-db");
    const store = createSearchStore(ctx.storage);

    // A failing projection must not take search down with it: queries are
    // answered from the index as it is, and the next query retries.
    async function catchUp(projection: string): Promise<void> {
      try {
        await ctx.content.catchUp(projection);
      } catch (error) {
        logger.warn("search index %s is behind: %s", projection, error);
      }
    }

    ctx.provide("search", store);
    registerProjections(ctx, store);
    registerRoutes(ctx, store, catchUp);
    registerSiteSearch(ctx, store, catchUp);
  },
});
