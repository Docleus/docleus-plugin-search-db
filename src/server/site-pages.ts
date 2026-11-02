import { z, type SiteFile, type SiteFileInput } from "@docleus/sdk";

/** Where a published page lives, as recorded in the artifact. */
export interface SitePageRef {
  readonly spaceId: string;
  readonly entryId: string;
  /** Site-relative, starting and ending with `/`. */
  readonly path: string;
}

const FORMAT = 1;

/**
 * The page list stored in every artifact published with search on. Page
 * placement is the publisher's business; recording its result here lets
 * the sites projection index a publication with the paths it was
 * published at, including after a rollback.
 */
export function sitePagesFile(input: SiteFileInput): SiteFile {
  const pages: SitePageRef[] = [];
  for (const page of input.pages) {
    if (page.kind !== "page" || page.entry === undefined) continue;
    pages.push({
      spaceId: page.space.id,
      entryId: page.entry.id,
      path: page.path,
    });
  }
  return {
    type: "application/json; charset=utf-8",
    body: JSON.stringify({ format: FORMAT, pages }),
  };
}

const SitePagesFileSchema = z.object({
  format: z.literal(FORMAT),
  pages: z.array(
    z.object({
      spaceId: z.string(),
      entryId: z.string(),
      path: z.string().startsWith("/"),
    }),
  ),
});

/** The pages of a stored {@link sitePagesFile}, or `undefined` when it is malformed. */
export function parseSitePagesFile(
  bytes: Uint8Array,
): SitePageRef[] | undefined {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
  const parsed = SitePagesFileSchema.safeParse(value);
  return parsed.success ? parsed.data.pages : undefined;
}
