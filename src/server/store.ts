import {
  DocleusError,
  type SearchDocument,
  type SearchHit,
  type SearchQuery,
  type SearchService,
  type StorageService,
  z,
} from "@docleus/sdk";
import type { Kysely } from "kysely";
import { PLUGIN_NAME } from "../shared/index.ts";
import {
  fts5Match,
  indexTerms,
  queryWords,
  snippetOf,
  tsQuery,
} from "./query-text.ts";
import { searchMigrations } from "./schema.ts";
import { placeholders, run } from "./sql.ts";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** The `search` service plus what this plugin's projections need. */
export interface SearchStore extends SearchService {
  /** Replaces every document of `collection` with `documents`, atomically. */
  replace(
    collection: string,
    documents: readonly SearchDocument[],
  ): Promise<void>;
  /** Removes every document of every collection whose name starts with `prefix`. */
  clearPrefix(prefix: string): Promise<void>;
}

const HitRowSchema = z
  .object({
    space_id: z.string(),
    entry_id: z.string(),
    revision: z.string(),
    title: z.string(),
    body: z.string(),
    path: z.string().nullable(),
    score: z
      .union([z.number(), z.string().transform(Number)])
      .pipe(z.number().refine((score) => !Number.isNaN(score))),
  })
  .transform((row) => ({
    spaceId: row.space_id,
    entryId: row.entry_id,
    revision: row.revision,
    title: row.title,
    body: row.body,
    path: row.path ?? undefined,
    score: row.score,
  }));

type HitRow = z.output<typeof HitRowSchema>;

const InsertedSchema = z.object({ id: z.number() });

function invalidRow(): DocleusError {
  return new DocleusError(
    "search/invalid-row",
    "a stored search document is malformed",
  );
}

function parseRow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw invalidRow();
  return parsed.data;
}

function limitOf(query: SearchQuery): number {
  const limit = query.limit ?? DEFAULT_LIMIT;
  return Math.max(0, Math.min(MAX_LIMIT, Math.floor(limit)));
}

/**
 * The `search` service over the instance database: an FTS5 table on SQLite,
 * a generated `tsvector` column with a GIN index on Postgres. Words are
 * folded (lowercased, diacritics removed) before either engine sees them.
 */
export function createSearchStore(storage: StorageService): SearchStore {
  const { dialect } = storage;
  const ready = storage.migrate(PLUGIN_NAME, searchMigrations(dialect));
  // Every call awaits `ready`, so a failure surfaces there.
  ready.catch(() => undefined);

  const sql = (
    db: Kysely<unknown>,
    statement: string,
    parameters?: readonly unknown[],
  ) => run(db, dialect, statement, parameters);

  async function deleteWhere(
    db: Kysely<unknown>,
    where: string,
    parameters: readonly unknown[],
  ): Promise<void> {
    if (dialect === "sqlite") {
      await sql(
        db,
        `delete from search_fts where rowid in (select id from search_documents where ${where})`,
        parameters,
      );
    }
    await sql(db, `delete from search_documents where ${where}`, parameters);
  }

  async function insert(
    db: Kysely<unknown>,
    collection: string,
    documents: readonly SearchDocument[],
  ): Promise<void> {
    for (const document of documents) {
      await deleteWhere(
        db,
        "collection = ? and space_id = ? and entry_id = ?",
        [collection, document.spaceId, document.entryId],
      );
      const titleTerms = indexTerms(document.title);
      const bodyTerms = indexTerms(document.text);
      const row = [
        collection,
        document.spaceId,
        document.entryId,
        document.revision,
        document.title,
        document.text,
        document.path ?? null,
      ];
      if (dialect === "postgres") {
        await sql(
          db,
          `insert into search_documents
            (collection, space_id, entry_id, revision, title, body, path, title_terms, body_terms)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [...row, titleTerms, bodyTerms],
        );
        continue;
      }
      const [inserted] = await sql(
        db,
        `insert into search_documents
          (collection, space_id, entry_id, revision, title, body, path)
          values (?, ?, ?, ?, ?, ?, ?) returning id`,
        row,
      );
      await sql(
        db,
        "insert into search_fts (rowid, title_terms, body_terms) values (?, ?, ?)",
        [parseRow(InsertedSchema, inserted).id, titleTerms, bodyTerms],
      );
    }
  }

  function write(fn: (db: Kysely<unknown>) => Promise<void>): Promise<void> {
    return ready.then(() => storage.transaction(fn));
  }

  async function select(
    collection: string,
    words: readonly string[],
    spaceIds: readonly string[],
    limit: number,
  ): Promise<HitRow[]> {
    const columns =
      "d.space_id, d.entry_id, d.revision, d.title, d.body, d.path";
    const spaces = placeholders(spaceIds.length);
    const rows =
      dialect === "postgres"
        ? await sql(
            storage.db,
            `select ${columns}, ts_rank(d.document, q.query) as score
              from search_documents d, to_tsquery('simple', ?) as q(query)
              where d.document @@ q.query and d.collection = ? and d.space_id in (${spaces})
              order by score desc, d.id
              limit ?`,
            [tsQuery(words), collection, ...spaceIds, limit],
          )
        : await sql(
            storage.db,
            `select ${columns}, -bm25(search_fts, 5.0, 1.0) as score
              from search_fts join search_documents d on d.id = search_fts.rowid
              where search_fts match ? and d.collection = ? and d.space_id in (${spaces})
              order by score desc, d.id
              limit ?`,
            [fts5Match(words), collection, ...spaceIds, limit],
          );
    return rows.map((row) => parseRow(HitRowSchema, row));
  }

  return {
    index(collection, documents) {
      return write((db) => insert(db, collection, documents));
    },
    remove(collection, spaceId, entryIds) {
      if (entryIds === undefined) {
        return write((db) =>
          deleteWhere(db, "collection = ? and space_id = ?", [
            collection,
            spaceId,
          ]),
        );
      }
      if (entryIds.length === 0) return ready;
      return write((db) =>
        deleteWhere(
          db,
          `collection = ? and space_id = ? and entry_id in (${placeholders(entryIds.length)})`,
          [collection, spaceId, ...entryIds],
        ),
      );
    },
    clear(collection) {
      return write((db) => deleteWhere(db, "collection = ?", [collection]));
    },
    replace(collection, documents) {
      return write(async (db) => {
        await deleteWhere(db, "collection = ?", [collection]);
        await insert(db, collection, documents);
      });
    },
    clearPrefix(prefix) {
      return write((db) =>
        deleteWhere(db, "substr(collection, 1, ?) = ?", [
          prefix.length,
          prefix,
        ]),
      );
    },
    async query(collection, query) {
      const words = queryWords(query.text);
      const limit = limitOf(query);
      if (words.length === 0 || query.spaceIds.length === 0 || limit === 0) {
        return [];
      }
      await ready;
      const rows = await select(collection, words, query.spaceIds, limit);
      return rows.map((row): SearchHit => ({
        spaceId: row.spaceId,
        entryId: row.entryId,
        revision: row.revision,
        title: row.title,
        ...(row.path === undefined ? {} : { path: row.path }),
        snippet: snippetOf(row.body, words),
        score: row.score,
      }));
    },
  };
}
