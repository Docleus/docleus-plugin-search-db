import {
  DocleusError,
  type Context,
  type HttpRequestContext,
  type Space,
  z,
} from "@docleus/sdk";
import {
  MAIN_COLLECTION,
  PLUGIN_NAME,
  type InstanceSearchResponse,
} from "../shared/index.ts";
import { MAIN_PROJECTION } from "./projections.ts";
import type { SearchStore } from "./store.ts";

/** The instance search route; it searches the heads of `main`. */
export const SEARCH_ROUTE = "/api/orgs/:orgId/search";

const STATUS_BY_CODE: Readonly<Record<string, number>> = {
  "search/invalid-request": 400,
  "search/forbidden": 403,
  "search/not-enabled": 404,
  "search/org-not-found": 404,
  "search/space-not-found": 404,
};

const QuerySchema = z.object({
  q: z.string().default(""),
  space: z.string().optional(),
  limit: z
    .string()
    .transform(Number)
    .pipe(z.number().int().min(1).max(100))
    .optional(),
});

type SearchParams = z.output<typeof QuerySchema>;

function parseQuery(url: URL): SearchParams {
  const parsed = QuerySchema.safeParse(
    Object.fromEntries(
      ["q", "space", "limit"].flatMap((name) => {
        const value = url.searchParams.get(name);
        return value === null ? [] : [[name, value]];
      }),
    ),
  );
  if (!parsed.success) {
    throw new DocleusError(
      "search/invalid-request",
      '"limit" must be an integer from 1 to 100',
    );
  }
  return parsed.data;
}

/**
 * Registers `GET /api/orgs/:orgId/search?q=&space=&limit=`: hits from the
 * heads of `main` of the org's spaces the caller may read and search is
 * enabled in, or of the one space `space` names.
 */
export function registerRoutes(
  ctx: Context,
  store: SearchStore,
  catchUp: (projection: string) => Promise<void>,
): void {
  const logger = ctx.logger("search-db");

  async function access(
    context: HttpRequestContext,
    space: Space,
  ): Promise<{ canRead: boolean; isEnabled: boolean }> {
    const scope = {
      kind: "space",
      orgId: space.orgId,
      spaceId: space.id,
    } as const;
    const [canRead, isEnabled] = await Promise.all([
      ctx.authz.can(context.actor, "read", scope),
      ctx.installations.isEnabled(PLUGIN_NAME, scope),
    ]);
    return { canRead, isEnabled };
  }

  async function searchable(
    context: HttpRequestContext,
    space: Space,
  ): Promise<boolean> {
    const { canRead, isEnabled } = await access(context, space);
    return canRead && isEnabled;
  }

  async function spacesOf(
    context: HttpRequestContext,
    orgId: string,
    only: string | undefined,
  ): Promise<Space[]> {
    if (!(await ctx.content.getOrg(orgId))) {
      throw new DocleusError(
        "search/org-not-found",
        `organization "${orgId}" does not exist`,
      );
    }
    const spaces = await ctx.content.listSpaces(orgId);
    if (only === undefined) {
      const allowed = await Promise.all(
        spaces.map((space) => searchable(context, space)),
      );
      return spaces.filter((_, index) => allowed[index]);
    }
    const space = spaces.find((candidate) => candidate.id === only);
    if (!space) {
      throw new DocleusError(
        "search/space-not-found",
        `space "${only}" does not exist`,
      );
    }
    const { canRead, isEnabled } = await access(context, space);
    if (!canRead) {
      throw new DocleusError(
        "search/forbidden",
        `cannot search space "${only}"`,
      );
    }
    if (!isEnabled) {
      throw new DocleusError(
        "search/not-enabled",
        `search is not enabled for space "${only}"`,
      );
    }
    return [space];
  }

  async function search(context: HttpRequestContext): Promise<Response> {
    const query = parseQuery(new URL(context.request.url));
    const orgId = context.params["orgId"] ?? "";
    const spaces = await spacesOf(context, orgId, query.space);
    await catchUp(MAIN_PROJECTION);
    const hits = await store.query(MAIN_COLLECTION, {
      text: query.q,
      spaceIds: spaces.map((space) => space.id),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    });
    const body: InstanceSearchResponse = {
      hits: hits.map((hit) => ({
        spaceId: hit.spaceId,
        entryId: hit.entryId,
        title: hit.title,
        snippet: hit.snippet,
      })),
    };
    return Response.json(body);
  }

  ctx.http.route("GET", SEARCH_ROUTE, async (context) => {
    try {
      return await search(context);
    } catch (error) {
      const status =
        error instanceof DocleusError ? STATUS_BY_CODE[error.code] : undefined;
      if (status === undefined || !(error instanceof DocleusError)) {
        logger.error(error);
        throw error;
      }
      return Response.json(
        { code: error.code, message: error.message },
        { status },
      );
    }
  });
}
