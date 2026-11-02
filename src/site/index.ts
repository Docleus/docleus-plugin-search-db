import { mountSearchBox, type SearchBoxEnvironment } from "./search-box.ts";

export { mountSearchBox, type SearchBoxEnvironment } from "./search-box.ts";

function mountAll(document: Document): void {
  const env: SearchBoxEnvironment = {
    fetch: (url, init) => fetch(url, init),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) =>
      clearTimeout(handle as ReturnType<typeof setTimeout> | undefined),
  };
  for (const form of document.querySelectorAll<HTMLFormElement>(
    "form[data-docleus-search]",
  )) {
    mountSearchBox(form, env);
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => mountAll(document), {
      once: true,
    });
  } else {
    mountAll(document);
  }
}
