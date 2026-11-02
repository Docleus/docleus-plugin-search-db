import type { SiteSearchHit } from "../shared/index.ts";

const DEBOUNCE_MS = 150;

// Checked by hand rather than with zod from `@docleus/sdk`: importing the
// SDK would make every published page load its whole browser bundle.
function parseHits(value: unknown): SiteSearchHit[] | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { hits } = value as Record<string, unknown>;
  if (!Array.isArray(hits)) return undefined;
  const parsed: SiteSearchHit[] = [];
  for (const hit of hits) {
    if (typeof hit !== "object" || hit === null) return undefined;
    const { title, path, snippet } = hit as Record<string, unknown>;
    if (
      typeof title !== "string" ||
      typeof path !== "string" ||
      typeof snippet !== "string"
    ) {
      return undefined;
    }
    parsed.push({ title, path, snippet });
  }
  return parsed;
}

/** What {@link mountSearchBox} needs from the browser; a seam for tests. */
export interface SearchBoxEnvironment {
  fetch(url: string, init: { signal: AbortSignal }): Promise<Response>;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/**
 * Makes a server-rendered search form live: queries `_search` next to the
 * site root as the user types and lists the hits. Every text goes in
 * through `textContent`. Without a `_search` endpoint (a static export),
 * it says that search is not available.
 */
export function mountSearchBox(
  form: HTMLFormElement,
  env: SearchBoxEnvironment,
): void {
  const input = form.querySelector<HTMLInputElement>("input[type=search]");
  const results = form.querySelector<HTMLElement>(".ds-search-results");
  if (!input || !results) return;
  const root = form.dataset["root"] ?? "./";
  const document = form.ownerDocument;
  let timer: unknown;
  let pending: AbortController | undefined;

  function show(nodes: Node[]): void {
    results?.replaceChildren(...nodes);
    if (results) results.hidden = nodes.length === 0;
  }

  function message(text: string): Node[] {
    const p = document.createElement("p");
    p.className = "ds-search-message";
    p.textContent = text;
    return [p];
  }

  function list(hits: readonly SiteSearchHit[]): Node[] {
    if (hits.length === 0) return message("No results");
    const ul = document.createElement("ul");
    for (const hit of hits) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = `${root}${hit.path.replace(/^\/+/, "")}`;
      const title = document.createElement("span");
      title.className = "ds-search-title";
      title.textContent = hit.title;
      a.append(title);
      if (hit.snippet !== "") {
        const snippet = document.createElement("span");
        snippet.className = "ds-search-snippet";
        snippet.textContent = hit.snippet;
        a.append(snippet);
      }
      li.append(a);
      ul.append(li);
    }
    return [ul];
  }

  async function search(text: string): Promise<void> {
    pending?.abort();
    if (text.trim() === "") return show([]);
    const controller = new AbortController();
    pending = controller;
    try {
      const response = await env.fetch(
        `${root}_search?q=${encodeURIComponent(text)}`,
        { signal: controller.signal },
      );
      const hits = response.ok ? parseHits(await response.json()) : undefined;
      if (controller.signal.aborted) return;
      show(hits ? list(hits) : message("Search is not available"));
    } catch {
      // A static host answers with HTML, which fails to parse, or not at all.
      if (!controller.signal.aborted) show(message("Search is not available"));
    }
  }

  input.addEventListener("input", () => {
    env.clearTimeout(timer);
    timer = env.setTimeout(() => void search(input.value), DEBOUNCE_MS);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    input.value = "";
    pending?.abort();
    show([]);
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    env.clearTimeout(timer);
    void search(input.value);
  });
  form.hidden = false;
}
