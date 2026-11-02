import { expect, test, type Page } from "@playwright/test";
import {
  editorBody,
  newPage,
  openNewSpace,
  publishSpace,
  save,
  typeLines,
} from "./helpers.ts";

async function writeDocs(page: Page): Promise<void> {
  await newPage(page, "Introduction");
  await typeLines(page, ["Welcome to the handbook."]);
  await save(page);

  await newPage(page, "Deployment");
  await typeLines(page, ["Run the container behind a reverse proxy."]);
  await save(page);
}

test("the site search box finds a published page", async ({ page }) => {
  const space = await openNewSpace(page);
  await writeDocs(page);
  const url = await publishSpace(page, space);

  await page.goto(url);
  const search = page.getByRole("search");
  await expect(search).toBeVisible();
  await search.getByRole("searchbox", { name: "Search" }).fill("proxy");
  const hit = search.getByRole("link", { name: /Deployment/ });
  await expect(hit).toBeVisible();
  await expect(hit).toContainText("reverse proxy");
  await expect(search.getByRole("link")).toHaveCount(1);

  await hit.click();
  await expect(page).toHaveURL(new RegExp(`${url}deployment/$`));
  await expect(
    page.getByRole("main").getByRole("heading", { level: 1 }),
  ).toHaveText("Deployment");

  await page
    .getByRole("search")
    .getByRole("searchbox", { name: "Search" })
    .fill("nothing-matches-this");
  await expect(page.getByRole("search")).toContainText("No results");
});

test("the command palette finds a page by its text and opens it", async ({
  page,
}) => {
  await openNewSpace(page);
  await writeDocs(page);

  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Search and commands" });
  await palette.getByLabel("Search pages and commands").fill("welcome");
  const hit = palette
    .getByRole("option", { name: /Introduction/ })
    .filter({ hasText: "Welcome to the handbook." });
  await expect(hit).toBeVisible();

  await hit.click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Introduction",
  );
  await expect(editorBody(page)).toContainText("Welcome to the handbook.");
});
