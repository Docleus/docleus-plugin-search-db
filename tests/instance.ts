import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PAGE_ENTRY_TYPE,
  type BlockNode,
  type Context,
  type EntryContent,
  type SpaceRole,
} from "@docleus/sdk";
import { PLUGIN_NAME } from "../src/shared/index.ts";
import { createPostgresDatabase, POSTGRES_URL } from "./storage.ts";

const ORIGIN = "http://localhost";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SITE_RUNTIME = fileURLToPath(
  new URL("./fixtures/site-runtime/", import.meta.url),
);

export interface Instance {
  readonly ctx: Context;
  fetch(request: Request): Promise<Response>;
  dispose(): Promise<void>;
}

interface ServerModule {
  createInstance(options: {
    baseDir: string;
    database?: string;
    plugins: readonly { id: string; plugin: string }[];
    siteRuntimeDir: string;
    isDev: boolean;
  }): Promise<Instance>;
}

// A literal specifier would pull core's sources into this package's
// typecheck. The module is typed here with the part the tests use.
const SERVER_MODULE: string = "@docleus/server";

export interface Client {
  readonly userId: string;
  call(method: string, path: string, body?: unknown): Promise<Response>;
  /** Throws unless the response is 2xx. */
  json<T>(method: string, path: string, body?: unknown): Promise<T>;
}

export interface Fixture {
  readonly instance: Instance;
  readonly orgId: string;
  /** A space with search enabled, through the org. */
  readonly spaceId: string;
  /** `/api/orgs/:orgId/sites`. */
  readonly sites: string;
  /** The org owner. */
  readonly owner: Client;
  createSpace(slug: string, isEnabled?: boolean): Promise<string>;
  /** A user with `role` on `spaceId`, or no role. */
  createUser(name: string, role: SpaceRole | undefined): Promise<Client>;
  /** Commits `put` and `remove` on top of the head of `branch`. */
  commit(
    spaceId: string,
    change: {
      put?: Record<string, EntryContent>;
      remove?: string[];
      branch?: string;
    },
  ): Promise<void>;
  get(path: string, headers?: Record<string, string>): Promise<Response>;
  dispose(): Promise<void>;
}

/** A page whose body is one paragraph of `text`. */
export function page(title: string, order: number, text = ""): EntryContent {
  const body: BlockNode = {
    id: "root",
    type: "doc",
    v: 1,
    attrs: {},
    content: [
      {
        id: "p1",
        type: "paragraph",
        v: 1,
        attrs: {},
        inline: [{ type: "text", text }],
      },
    ],
  };
  return {
    type: PAGE_ENTRY_TYPE,
    title,
    parent: undefined,
    order,
    fields: {},
    body,
  };
}

// The real manifest with its server entry pointed at the sources and the
// stylesheet the site head links next to a stub site script, so the tests
// need no build.
async function pluginDir(cleanups: (() => Promise<void>)[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "docleus-search-db-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const manifest = JSON.parse(
    await readFile(join(ROOT, "docleus.plugin.json"), "utf8"),
  ) as Record<string, unknown>;
  await mkdir(join(dir, "dist/site"), { recursive: true });
  await writeFile(join(dir, "dist/site/index.js"), "export {};\n");
  await copyFile(
    join(ROOT, "src/site/search.css"),
    join(dir, "dist/site/search.css"),
  );
  await writeFile(
    join(dir, "docleus.plugin.json"),
    JSON.stringify({
      ...manifest,
      entries: {
        server: join(ROOT, "src/server/index.ts"),
        site: "./dist/site/index.js",
      },
    }),
  );
  return dir;
}

function clientOf(instance: Instance, userId: string, token: string): Client {
  const call = (method: string, path: string, body?: unknown) =>
    instance.fetch(
      new Request(new URL(path, ORIGIN), {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body !== undefined && { "content-type": "application/json" }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      }),
    );
  return {
    userId,
    call,
    async json<T>(method: string, path: string, body?: unknown) {
      const response = await call(method, path, body);
      if (!response.ok) {
        throw new Error(
          `${method} ${path}: ${response.status} ${await response.text()}`,
        );
      }
      return (await response.json()) as T;
    },
  };
}

/**
 * A real instance (in-memory SQLite, or a fresh Postgres database when
 * `DOCLEUS_TEST_POSTGRES_URL` is set) with this plugin mounted from a
 * plugin row and enabled for one org with one space.
 */
export async function setUp(): Promise<Fixture> {
  const cleanups: (() => Promise<void>)[] = [];
  const dispose = async () => {
    for (const cleanup of cleanups.splice(0).toReversed()) await cleanup();
  };
  try {
    let database: string | undefined;
    if (POSTGRES_URL !== undefined) {
      const created = await createPostgresDatabase();
      cleanups.push(created.drop);
      database = created.url;
    }
    const server = (await import(SERVER_MODULE)) as ServerModule;
    const instance = await server.createInstance({
      baseDir: ROOT,
      database,
      plugins: [{ id: "search-db", plugin: await pluginDir(cleanups) }],
      siteRuntimeDir: SITE_RUNTIME,
      isDev: true,
    });
    cleanups.push(() => instance.dispose());
    const { ctx } = instance;

    async function createUser(
      name: string,
      grant: { orgRole?: "owner"; spaceRole?: SpaceRole; spaceId?: string },
    ): Promise<Client> {
      const user = await ctx.identity.createUser({
        email: `${name.toLowerCase()}@example.com`,
        name,
      });
      if (grant.orgRole) {
        await ctx.authz.grant(
          user.id,
          { kind: "org", orgId: org.id },
          grant.orgRole,
        );
      }
      if (grant.spaceRole && grant.spaceId) {
        await ctx.authz.grant(
          user.id,
          { kind: "space", orgId: org.id, spaceId: grant.spaceId },
          grant.spaceRole,
        );
      }
      return clientOf(
        instance,
        user.id,
        await ctx.identity.createSession(user.id),
      );
    }

    const org = await ctx.content.createOrg({ slug: "acme", name: "Acme" });
    await ctx.installations.setEnabled(
      PLUGIN_NAME,
      { kind: "org", orgId: org.id },
      true,
    );

    async function createSpace(slug: string, isEnabled = true) {
      const space = await ctx.content.createSpace({
        orgId: org.id,
        slug,
        name: slug,
      });
      if (!isEnabled) {
        await ctx.installations.setEnabled(
          PLUGIN_NAME,
          { kind: "space", orgId: org.id, spaceId: space.id },
          false,
        );
      }
      return space.id;
    }

    const spaceId = await createSpace("docs");
    const owner = await createUser("Owner", { orgRole: "owner" });

    return {
      instance,
      orgId: org.id,
      spaceId,
      sites: `/api/orgs/${org.id}/sites`,
      owner,
      createSpace,
      createUser: (name, role) =>
        createUser(
          name,
          role === undefined ? {} : { spaceRole: role, spaceId },
        ),
      async commit(target, { put, remove, branch }) {
        const head = await ctx.content.head(target, branch);
        await ctx.content.commit({
          spaceId: target,
          ...(branch === undefined ? {} : { branch }),
          parent: head?.id,
          ...(put === undefined ? {} : { put }),
          ...(remove === undefined ? {} : { remove }),
          message: "Change",
        });
      },
      get: (path, headers = {}) =>
        instance.fetch(new Request(new URL(path, ORIGIN), { headers })),
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
