import {
  DocleusError,
  z,
  type UiSearchProvider,
  type UiSearchResult,
  type UiService,
} from "@docleus/sdk";

const enc = encodeURIComponent;

type Request = UiService["request"];

const ResponseSchema = z.object({
  hits: z.array(
    z.object({
      spaceId: z.string(),
      entryId: z.string(),
      title: z.string(),
      snippet: z.string(),
    }),
  ),
});

/** The org's `/api/orgs/:orgId/search` query for `text`, in one space when given. */
export function searchPath(
  orgId: string,
  spaceId: string | undefined,
  text: string,
): string {
  const space = spaceId === undefined ? "" : `&space=${enc(spaceId)}`;
  return `/api/orgs/${enc(orgId)}/search?q=${enc(text)}${space}`;
}

/** A page in the host, shown at `main`, where the hits come from. */
export function pageHref(orgId: string, spaceId: string, entryId: string) {
  return `/orgs/${enc(orgId)}/spaces/${enc(spaceId)}/pages/${enc(entryId)}`;
}

/**
 * Full-text results for the command palette: the pages of the current space
 * whose text matches, or of the whole organization outside a space. Their
 * second line is the matching sentence.
 */
export function createPaletteSearch(request: Request): UiSearchProvider {
  return async (query, context) => {
    const { orgId } = context;
    if (orgId === undefined || query.trim() === "") return [];
    const response = await request(
      searchPath(orgId, context.spaceId, query.trim()),
      { signal: context.signal },
    );
    if (!response.ok) {
      throw new DocleusError(
        "search-db/request-failed",
        `search answered ${response.status}`,
      );
    }
    const parsed = ResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new DocleusError(
        "search-db/invalid-response",
        parsed.error.message,
      );
    }
    return parsed.data.hits.map((hit): UiSearchResult => ({
      id: `${hit.spaceId}/${hit.entryId}`,
      label: hit.title || "Untitled",
      ...(hit.snippet !== "" && { detail: hit.snippet }),
      href: pageHref(orgId, hit.spaceId, hit.entryId),
    }));
  };
}
