// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { mountSearchBox, type SearchBoxEnvironment } from "./search-box.ts";

interface FakeEnvironment extends SearchBoxEnvironment {
  readonly requests: string[];
  respond: (url: string) => Promise<Response>;
  /** Runs the pending debounce timer, then lets the fetch settle. */
  flush(): Promise<void>;
}

function fakeEnvironment(): FakeEnvironment {
  let pending: (() => void) | undefined;
  const env: FakeEnvironment = {
    requests: [],
    respond: () => Promise.resolve(Response.json({ hits: [] })),
    fetch(url) {
      env.requests.push(url);
      return env.respond(url);
    },
    setTimeout(fn) {
      pending = fn;
      return fn;
    },
    clearTimeout(handle) {
      if (handle === pending) pending = undefined;
    },
    async flush() {
      const run = pending;
      pending = undefined;
      run?.();
      for (let i = 0; i < 5; i++) await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
  return env;
}

function renderForm(root: string): HTMLFormElement {
  document.body.innerHTML = [
    `<form class="ds-search" data-docleus-search data-root="${root}" hidden>`,
    `<input id="ds-search-input" type="search" name="q">`,
    `<div id="ds-search-results" class="ds-search-results" hidden></div>`,
    `</form>`,
  ].join("");
  const form = document.querySelector("form");
  if (!form) throw new Error("no form");
  return form;
}

function type(form: HTMLFormElement, text: string): void {
  const input = form.querySelector("input");
  if (!input) throw new Error("no input");
  input.value = text;
  input.dispatchEvent(new Event("input"));
}

const results = () => document.querySelector<HTMLElement>(".ds-search-results");

describe("site search box", () => {
  let env: FakeEnvironment;

  beforeEach(() => {
    env = fakeEnvironment();
  });

  it("shows itself and lists hits as links relative to the site root", async () => {
    const form = renderForm("../../");
    mountSearchBox(form, env);
    expect(form.hidden).toBe(false);
    env.respond = () =>
      Promise.resolve(
        Response.json({
          hits: [
            { title: "Install", path: "/guides/install/", snippet: "Run it." },
            { title: "Home", path: "/", snippet: "" },
          ],
        }),
      );
    type(form, "inst all");
    await env.flush();

    expect(env.requests).toEqual(["../../_search?q=inst%20all"]);
    expect(results()?.hidden).toBe(false);
    const links = [...document.querySelectorAll("a")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "../../guides/install/",
      "../../",
    ]);
    expect(links[0]?.querySelector(".ds-search-title")?.textContent).toBe(
      "Install",
    );
    expect(links[0]?.querySelector(".ds-search-snippet")?.textContent).toBe(
      "Run it.",
    );
    expect(links[1]?.querySelector(".ds-search-snippet")).toBeNull();
  });

  it("inserts hit text as text, never as markup", async () => {
    const form = renderForm("./");
    mountSearchBox(form, env);
    env.respond = () =>
      Promise.resolve(
        Response.json({
          hits: [{ title: "<img src=x>", path: "/a/", snippet: "<b>bold</b>" }],
        }),
      );
    type(form, "x");
    await env.flush();
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("b")).toBeNull();
    expect(document.querySelector(".ds-search-title")?.textContent).toBe(
      "<img src=x>",
    );
  });

  it("says when nothing matches and clears on an empty query or Escape", async () => {
    const form = renderForm("./");
    mountSearchBox(form, env);
    type(form, "zzz");
    await env.flush();
    expect(results()?.textContent).toBe("No results");

    type(form, "  ");
    await env.flush();
    expect(results()?.hidden).toBe(true);
    expect(results()?.childNodes).toHaveLength(0);

    type(form, "zzz");
    await env.flush();
    form
      .querySelector("input")
      ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(form.querySelector("input")?.value).toBe("");
    expect(results()?.hidden).toBe(true);
  });

  it("says search is not available on a static host", async () => {
    const form = renderForm("./");
    mountSearchBox(form, env);
    env.respond = () =>
      Promise.resolve(new Response("<html></html>", { status: 404 }));
    type(form, "a");
    await env.flush();
    expect(results()?.textContent).toBe("Search is not available");

    env.respond = () => Promise.resolve(new Response("<html></html>"));
    type(form, "b");
    await env.flush();
    expect(results()?.textContent).toBe("Search is not available");

    env.respond = () => Promise.reject(new TypeError("offline"));
    type(form, "c");
    await env.flush();
    expect(results()?.textContent).toBe("Search is not available");
  });

  it("debounces typing and searches at once on submit", async () => {
    const form = renderForm("./");
    mountSearchBox(form, env);
    type(form, "a");
    type(form, "ab");
    type(form, "abc");
    await env.flush();
    expect(env.requests).toEqual(["./_search?q=abc"]);

    type(form, "abcd");
    const submit = new Event("submit", { cancelable: true });
    form.dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(true);
    await env.flush();
    expect(env.requests).toEqual(["./_search?q=abc", "./_search?q=abcd"]);
  });
});
