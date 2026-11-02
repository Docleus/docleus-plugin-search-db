import { createStorageService } from "@docleus/core-storage";
import { Context } from "@docleus/kernel";
import type { StorageService } from "@docleus/sdk";
import { createTestPostgresDatabase, testPostgresUrl } from "@docleus/testing";

/** The Postgres admin URL tests run against, or `undefined` for SQLite only. */
export const POSTGRES_URL = testPostgresUrl();

/**
 * Opens storage at `location` (in-memory SQLite when omitted). The
 * connection closes through `ctx.effect()`, which only runs when a plugin
 * fiber unloads, so the storage lives in its own plugin.
 */
export async function openStorage(
  location?: string,
): Promise<{ storage: StorageService; close(): Promise<void> }> {
  let storage: StorageService | undefined;
  const fiber = await new Context().plugin((ctx: Context) => {
    storage = createStorageService(ctx, location);
  });
  if (!storage) throw new Error("storage was not created");
  return { storage, close: () => fiber.dispose() };
}

/** Creates an empty Postgres database on {@link POSTGRES_URL}. */
export async function createPostgresDatabase(): Promise<{
  url: string;
  drop(): Promise<void>;
}> {
  if (POSTGRES_URL === undefined) throw new Error("no postgres server");
  return createTestPostgresDatabase(POSTGRES_URL);
}
