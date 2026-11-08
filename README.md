<p align="center">
  <a href="https://docleus.io"><img src="./.github/assets/docleus.svg" width="88" alt="Docleus logo" /></a>
</p>

<h1 align="center">Database Search</h1>

<p align="center">
  <strong>Find the page. Keep your stack small.</strong><br />
  Full-text search for editor and published sites, on SQLite or Postgres.
</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-111111?style=flat-square" /></a>
  <img alt="Public preview in preparation" src="https://img.shields.io/badge/preview-0.0.8-cfcfcf?style=flat-square" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square" />
  <a href="https://docleus.io"><img alt="Online documentation" src="https://img.shields.io/badge/docs-docleus.io-111111?style=flat-square" /></a>
</p>

<p align="center">
  <a href="https://docleus.io">Documentation</a> &middot;
  <a href="#install">Install</a> &middot;
  <a href="https://github.com/Docleus/docleus">Run Docleus</a> &middot;
  <a href="https://github.com/Docleus/.github/blob/main/CONTRIBUTING.md">Contribute</a>
</p>

---

Full-text search in the instance database: SQLite FTS5 or Postgres `tsvector` with a GIN index. It provides the `search` service, keeps an index of every space's `main` and of every published site, answers search requests from the editor and from published sites, and adds a search box to both.

## Install

Add this row to the deployment config's `plugins` list (paths resolve relative
to that file), or use the default distribution, which already includes it.

```yaml
plugins:
  - id: search-db
    plugin: ../docleus-plugin-search-db
```

Run `pnpm build` first: the instance loads `dist/server/index.js`, `dist/editor/index.js` and `dist/site/index.js` from `docleus.plugin.json`. Organizations created in the browser enable installed plugins automatically; organizations created through the API need explicit enablement. For an existing organization or a space with an explicit override, enable it in Settings, Plugins, or with `PUT /api/orgs/:orgId/plugins` or `PUT /api/orgs/:orgId/spaces/:spaceId/plugins`, sending `{ "plugin": "@docleus/plugin-search-db", "enabled": true }`.

The server entry needs the `storage`, `content`, `blocks`, `blobs`, `http`, `authz`, `installations`, `render` and `sites` services. It has no config. The dialect follows `ctx.storage`, so the same plugin works on SQLite and on Postgres.

## The `search` service

`ctx.search` implements `SearchService` from `@docleus/sdk`:

- `index(collection, documents)`
- `remove(collection, spaceId, entryIds)`
- `clear(collection)`
- `query(collection, { text, spaceIds, limit? })`

Hits come best first. Each hit has `spaceId`, `entryId`, `title`, a plain-text `snippet` of about 160 characters around the first match, `score`, and `path` when the document has one. `limit` defaults to 20 and is capped at 100.

Query matching works as follows:

- Every word must match.
- The last word also matches as a prefix, so results appear while the user types.
- Case and diacritics are folded on both the documents and the queries, so `cafe` finds `Café`.
- Queries are plain text. Operators and quotes have no special meaning.

Documents are their title (weighted higher) and `ctx.blocks.text(body)`.

The plugin keeps two kinds of collections:

| Collection      | Contents                                                                                     | Kept by projection |
| --------------- | -------------------------------------------------------------------------------------------- | ------------------ |
| `main`          | The pages at the head of every space's `main`. Other branches are not indexed.               | `search-db/main`   |
| `site:<siteId>` | The pages of the site's active publication, with their site paths. A rollback replaces them. | `search-db/sites`  |

The index is derived state. Both projections read only the content log, revisions and artifacts, so `ctx.content.rebuild("search-db/main")` or `ctx.content.rebuild("search-db/sites")` recreates the same index that the incremental updates built. Requests call `ctx.content.catchUp` before they query, so a search right after a commit or a publish sees it.

Every artifact published while the plugin is enabled for the site's first space carries `_search/pages.json`, which lists the entry and path of each page. The sites projection reads it to index a publication at the paths it was published at, including after a rollback. A publication made without it, for example one published before search was enabled, leaves the site's collection empty.

## HTTP API

`GET /api/orgs/:orgId/search?q=&space=&limit=` searches collection `main`. The response is `{ hits: [{ spaceId, entryId, title, snippet }] }`.

- Without `space`, it searches every space of the org where the caller has `read` and the plugin is enabled.
- With `space`, it searches that one space. It answers 404 `search/space-not-found` if the space does not exist, 403 `search/forbidden` if the caller cannot read it, and 404 `search/not-enabled` if the plugin is not enabled for it.
- An unknown org answers 404 `search/org-not-found`.
- A `limit` outside 1 to 100 answers 400 `search/invalid-request`.

Errors answer `{ code, message }`.

## Published sites

A `site/request` listener answers `GET` (and `HEAD`) `_search?q=`, next to the site's pages. That covers `/sites/<org>/<site>/_search?q=` and `https://docs.example.com/_search?q=` on a custom domain. The response is `{ hits: [{ title, path, snippet }] }`, with `cache-control: no-store`. Each `path` is site-relative and starts with `/`, and is always one of the active publication's pages. A site with no publication answers `{ hits: [] }`.

The site layout gets:

- In `site.head`, the stylesheet `dist/site/search.css`. It uses the default theme's variables, with fallbacks.
- In `site.header`, a search form. It is hidden until the site script (`dist/site/index.js`) mounts it.

The script queries `_search` relative to the site root as the user types, lists the hits as links relative to the current page, and inserts all text with `textContent`.

Static exports (`docleus export`) have no search, because `_search` needs the running instance. On a static host, the box says "Search is not available".

## Editor

The editor entry adds page results to the command palette (⌘K, `ctx.ui.registerSearch`). It searches the current space's `main` through the HTTP API, shows the matching text under each title, and opens a hit in place.

## Tests

- `pnpm test` runs:
  - unit tests next to the code, including `searchConformanceSuite` from `@docleus/conformance` against the store;
  - integration tests (`tests/search.test.ts`) against a real instance from `@docleus/server` with this plugin mounted from a plugin row. They cover publishing, rollback, the custom domain, access control, and that a rebuild equals the incremental index.
- Set `DOCLEUS_TEST_POSTGRES_URL` (an admin URL) to run the store and integration tests on Postgres too. Each test creates and drops its own `s2_<random>` database.
- `pnpm e2e` runs the Playwright tests in `tests/e2e/`: the site search box finds a published page, and the command palette finds a page by its text and opens it.

## Development

Use Node.js 24 and pnpm 11.21.0. Keep this repository next to `docleus-core`
with its original directory name; the `link:` development dependencies need
that layout. Install core before this repository:

```sh
pnpm --dir ../docleus-core install --frozen-lockfile
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

`pnpm check` runs typecheck, lint, formatting, dependency boundaries, licenses,
and unit/in-process integration tests. Browser and external-service tests,
where provided, are separate and need the sibling repositories listed in
their setup files. The SDK is a host-provided peer dependency; packages remain
private and are not installed from npm. All extension points are experimental
before 1.0.

## Community

[Contributing](https://github.com/Docleus/.github/blob/main/CONTRIBUTING.md) &middot;
[Code of conduct](https://github.com/Docleus/.github/blob/main/CODE_OF_CONDUCT.md) &middot;
[Security](https://github.com/Docleus/.github/blob/main/SECURITY.md) &middot;
[Support](https://github.com/Docleus/.github/blob/main/SUPPORT.md)

## License

[MIT](LICENSE)

## Compatibility

Version `0.0.8` supports Docleus core and SDK `0.0.1`, `0.0.2`, `0.0.3`, `0.0.4`, `0.0.5`, `0.0.6`, `0.0.7` and `0.0.8` through
the matching `>=0.0.1 <0.0.9` manifest and SDK peer ranges.
