import {
  escapeHtml,
  type Context,
  type SitePage,
  type SiteRequest,
} from "@docleus/sdk";
import {
  PLUGIN_NAME,
  SITE_PAGES_FILE,
  SITE_SEARCH_PATH,
  siteCollection,
  type SiteSearchHit,
  type SiteSearchResponse,
} from "../shared/index.ts";
import { SITES_PROJECTION } from "./projections.ts";
import { sitePagesFile } from "./site-pages.ts";
import type { SearchStore } from "./store.ts";

const STYLESHEET = "dist/site/search.css";

/**
 * The `site.header` search form. It starts hidden: the site script shows
 * it and makes it live, so a page without scripts has no dead search box.
 */
export function searchForm(page: SitePage): string {
  const root = escapeHtml(page.url("/"));
  return [
    `<form class="ds-search" role="search" data-docleus-search data-root="${root}" hidden>`,
    `<label class="ds-search-label" for="ds-search-input">Search</label>`,
    `<input id="ds-search-input" class="ds-search-input" type="search" name="q" placeholder="Search" autocomplete="off" aria-controls="ds-search-results">`,
    `<div id="ds-search-results" class="ds-search-results" aria-live="polite" hidden></div>`,
    `</form>`,
  ].join("");
}

function siteResponse(request: Request, body: SiteSearchResponse): Response {
  const response = Response.json(body, {
    headers: { "cache-control": "no-store" },
  });
  return request.method === "HEAD"
    ? new Response(null, { headers: response.headers })
    : response;
}

/**
 * Adds search to published sites: the page list every artifact carries,
 * the search box in the header, and `_search?q=` answered next to the
 * site's pages, under `/sites/<org>/<site>/` and on custom domains alike.
 */
export function registerSiteSearch(
  ctx: Context,
  store: SearchStore,
  catchUp: (projection: string) => Promise<void>,
): void {
  ctx.render.registerFile(SITE_PAGES_FILE, sitePagesFile);
  ctx.render.registerSlot("site.head", {
    id: PLUGIN_NAME,
    render: (page) =>
      `<link rel="stylesheet" href="${escapeHtml(page.asset(PLUGIN_NAME, STYLESHEET))}">`,
  });
  ctx.render.registerSlot("site.header", {
    id: PLUGIN_NAME,
    render: searchForm,
  });

  ctx.on(
    "site/request",
    async (
      input: SiteRequest,
      next: () => Promise<Response>,
    ): Promise<Response> => {
      const { request } = input;
      const isSearch =
        input.path === SITE_SEARCH_PATH ||
        input.path === `${SITE_SEARCH_PATH}/`;
      if (
        !isSearch ||
        (request.method !== "GET" && request.method !== "HEAD")
      ) {
        return next();
      }
      const text = new URL(request.url).searchParams.get("q") ?? "";
      if (input.publication === undefined) {
        return siteResponse(request, { hits: [] });
      }
      await catchUp(SITES_PROJECTION);
      const hits = await store.query(siteCollection(input.site.id), {
        text,
        spaceIds: Object.keys(input.publication.revisions),
      });
      return siteResponse(request, {
        hits: hits.flatMap((hit): SiteSearchHit[] =>
          hit.path === undefined
            ? []
            : [{ title: hit.title, path: hit.path, snippet: hit.snippet }],
        ),
      });
    },
  );
}
