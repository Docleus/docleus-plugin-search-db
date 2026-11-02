import { definePlugin } from "@docleus/sdk";
import { PLUGIN_NAME } from "../shared/index.ts";
import { createPaletteSearch } from "./palette.ts";

/** Adds full-text page results to the command palette (⌘K). */
export const plugin = definePlugin({
  name: PLUGIN_NAME,
  inject: ["ui"],
  apply(ctx) {
    ctx.ui.registerSearch(
      createPaletteSearch((path, init) => ctx.ui.request(path, init)),
    );
  },
});
