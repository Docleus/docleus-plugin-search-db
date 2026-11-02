export const PLUGIN_NAME = "@docleus/plugin-search-db";

/** The collection that holds the head of `main` of every space. */
export const MAIN_COLLECTION = "main";

/** What every site collection's name starts with. */
export const SITE_COLLECTION_PREFIX = "site:";

/** The collection that holds the pages of a site's active publication. */
export function siteCollection(siteId: string): string {
  return `${SITE_COLLECTION_PREFIX}${siteId}`;
}

/** The site-relative path a published site answers search queries at. */
export const SITE_SEARCH_PATH = "/_search";

/**
 * The site-relative path of the file that maps a publication's pages to
 * their paths. It is part of every artifact published with search on.
 */
export const SITE_PAGES_FILE = "/_search/pages.json";

/** A hit of `GET /api/orgs/:orgId/search`. */
export interface InstanceSearchHit {
  readonly spaceId: string;
  readonly entryId: string;
  readonly title: string;
  readonly snippet: string;
}

/** The body of `GET /api/orgs/:orgId/search`. */
export interface InstanceSearchResponse {
  readonly hits: readonly InstanceSearchHit[];
}

/** A hit of a site's `_search`; `path` is site-relative, starting and ending with `/`. */
export interface SiteSearchHit {
  readonly title: string;
  readonly path: string;
  readonly snippet: string;
}

/** The body of a site's `_search?q=`. */
export interface SiteSearchResponse {
  readonly hits: readonly SiteSearchHit[];
}
