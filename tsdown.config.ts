import { defineConfig } from "tsdown";

const common = {
  format: "esm",
  dts: false,
  outExtensions: () => ({ js: ".js" }),
} as const;

/** Provided by the host's import map; never bundled. */
const HOST_MODULES = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "react-dom/client",
  "@docleus/sdk",
];

export default defineConfig([
  {
    ...common,
    entry: {
      "shared/index": "src/shared/index.ts",
      "server/index": "src/server/index.ts",
    },
    clean: ["dist/shared", "dist/server", "dist/*.js"],
  },
  {
    // Browser builds of their own, so their chunks stay inside the browser
    // roots the host serves and publishes: `dist/editor` and `dist/site`.
    ...common,
    entry: { index: "src/editor/index.ts" },
    outDir: "dist/editor",
    platform: "browser",
    external: HOST_MODULES,
    clean: true,
  },
  {
    ...common,
    entry: { index: "src/site/index.ts" },
    outDir: "dist/site",
    platform: "browser",
    external: HOST_MODULES,
    clean: true,
    copy: [{ from: "src/site/search.css", to: "dist/site" }],
  },
]);
