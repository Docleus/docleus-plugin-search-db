import type { Migration, StorageDialect } from "@docleus/sdk";
import { run } from "./sql.ts";

const SQLITE: readonly string[] = [
  `create table search_documents (
    id integer primary key autoincrement,
    collection text not null,
    space_id text not null,
    entry_id text not null,
    revision text not null,
    title text not null,
    body text not null,
    path text,
    unique (collection, space_id, entry_id)
  )`,
  // Rows share their rowid with `search_documents.id`. The terms are folded
  // in JavaScript already (see `indexTerms`), so the tokenizer only splits.
  `create virtual table search_fts using fts5(
    title_terms,
    body_terms,
    tokenize = 'unicode61 remove_diacritics 0'
  )`,
];

const POSTGRES: readonly string[] = [
  `create table search_documents (
    id bigserial primary key,
    collection text not null,
    space_id text not null,
    entry_id text not null,
    revision text not null,
    title text not null,
    body text not null,
    path text,
    title_terms text not null,
    body_terms text not null,
    document tsvector generated always as (
      setweight(to_tsvector('simple', title_terms), 'A') ||
      setweight(to_tsvector('simple', body_terms), 'B')
    ) stored,
    unique (collection, space_id, entry_id)
  )`,
  `create index search_documents_document on search_documents using gin (document)`,
];

/** The plugin's tables for `dialect`: a full-text index of search documents. */
export function searchMigrations(dialect: StorageDialect): Migration[] {
  const statements = dialect === "postgres" ? POSTGRES : SQLITE;
  return [
    {
      id: "001-search-documents",
      async up(db) {
        for (const statement of statements) await run(db, dialect, statement);
      },
    },
  ];
}
