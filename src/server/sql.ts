import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type { StorageDialect } from "@docleus/sdk";

type CompiledQuery = Parameters<Kysely<unknown>["executeQuery"]>[0];

/**
 * Runs one SQL statement written with `?` placeholders, numbered as `$1`,
 * `$2` ... on Postgres. Full-text search needs SQL that the query builder
 * cannot express (virtual tables, `MATCH`, `tsvector`), and plugins have no
 * runtime copy of Kysely's `sql` tag, so the statement is handed to the
 * storage's own Kysely instance as an already compiled query.
 */
export async function run(
  db: Kysely<unknown>,
  dialect: StorageDialect,
  text: string,
  parameters: readonly unknown[] = [],
): Promise<unknown[]> {
  let index = 0;
  const statement =
    dialect === "postgres" ? text.replaceAll("?", () => `$${++index}`) : text;
  const query: CompiledQuery = {
    sql: statement,
    parameters,
    query: { kind: "RawNode", sqlFragments: [statement], parameters: [] },
    queryId: { queryId: randomUUID() },
  };
  const result = await db.executeQuery(query);
  return [...result.rows];
}

/** `?, ?, ?` for `count` values. */
export function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}
