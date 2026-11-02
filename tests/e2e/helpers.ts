import { expect, type Locator, type Page } from "@playwright/test";

let counter = 0;

/** A slug unique within the run, so tests share one server but no data. */
export function uniqueSlug(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

export interface NewSpace {
  readonly orgId: string;
  readonly orgSlug: string;
  readonly spacePath: string;
}

export async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  const form = page.getByRole("form", { name: "Development sign-in" });
  await form.getByLabel("Email").fill("e2e@example.com");
  await form.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { name: "Organizations" }),
  ).toBeVisible();
}

/** Signs in and creates an organization and a space in it. */
export async function openNewSpace(page: Page): Promise<NewSpace> {
  await signIn(page);
  const orgSlug = uniqueSlug("org");
  await page.goto("/?new=org");
  const org = page.getByRole("form", { name: "Create organization" });
  await org.getByLabel("Name").fill("E2E");
  await org.getByLabel("Slug").fill(orgSlug);
  await org.getByRole("button", { name: "Create organization" }).click();

  await expect(page).toHaveURL(/\/orgs\/[^/?]+$/);

  await page.goto(`${new URL(page.url()).pathname}?new=space`);

  const space = page.getByRole("form", { name: "Create space" });
  await space.getByLabel("Name").fill("Docs");
  await space.getByLabel("Slug").fill(uniqueSlug("space"));
  await space.getByRole("button", { name: "Create space" }).click();
  await expect(page).toHaveURL(/\/orgs\/[^/]+\/spaces\/[^/]+$/);
  const spacePath = new URL(page.url()).pathname;
  const orgId = spacePath.split("/")[2] ?? "";
  return { orgId, orgSlug, spacePath };
}

export function editorBody(page: Page): Locator {
  return page.getByRole("textbox", { name: "Page body" });
}

export function pageTree(page: Page): Locator {
  return page.getByRole("navigation", { name: "Pages", exact: true });
}

/** Runs a row action of the page tree from the row's ⋯ menu. */
async function treeAction(
  page: Page,
  title: string,
  action: string,
): Promise<void> {
  const tree = pageTree(page);
  await tree.getByRole("link", { name: title, exact: true }).hover();
  await tree.getByRole("button", { name: `Actions for ${title}` }).click();
  await page
    .getByRole("menu", { name: `Actions for ${title}` })
    .getByRole("menuitem", { name: action })
    .click();
}

async function renameCurrent(page: Page, title: string): Promise<void> {
  await treeAction(page, "Untitled", "Rename");
  await page.getByLabel("Rename page").fill(title);
  await page.getByLabel("Rename page").press("Enter");
  await expect(pageTree(page).getByRole("link", { name: title })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  await expect(editorBody(page)).toBeVisible();
}

/** Creates a top-level page and names it; the editor shows it afterwards. */
export async function newPage(page: Page, title: string): Promise<void> {
  await page
    .getByRole("button", { name: /^\+? ?New page$/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/pages\/[^/?]+(\?.*)?$/);
  await expect(editorBody(page)).toBeVisible();
  await renameCurrent(page, title);
}

/** Types Markdown-shortcut lines into an empty page body. */
export async function typeLines(
  page: Page,
  lines: readonly string[],
): Promise<void> {
  await editorBody(page).click();
  for (const [i, line] of lines.entries()) {
    if (i > 0) await page.keyboard.press("Enter");
    await page.keyboard.type(line);
  }
}

export async function save(page: Page): Promise<void> {
  await page.getByRole("textbox", { name: "Page body" }).focus();
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.locator(".bar .save-state")).toHaveText("Saved");
}

/**
 * Publishes the space from its top bar: the first time this creates the
 * space's site at `siteSlug` (or a fresh one); later it publishes main
 * again. Resolves to the site's URL path.
 */
export async function publishSpace(
  page: Page,
  space: NewSpace,
  siteSlug: string = uniqueSlug("site"),
): Promise<string> {
  await page.goto(space.spacePath);
  const bar = page.locator("header.bar");
  await bar.getByRole("button", { name: /^Publish/ }).click();
  const first = page.getByRole("dialog", { name: "Publish this space" });
  const again = page.getByRole("dialog", { name: "Publish" });
  await expect(first.or(again)).toBeVisible();
  let path = "";
  if (await first.isVisible()) {
    await first.getByLabel("Site address").fill(siteSlug);
    await first.getByRole("button", { name: "Publish", exact: true }).click();
    path = `/sites/${space.orgSlug}/${siteSlug}/`;
  } else {
    path = (await again.getByRole("link").first().textContent()) ?? "";
    await again.getByRole("button", { name: "Publish now" }).click();
  }
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /^Published / })
      .first(),
  ).toBeVisible();
  return path;
}
