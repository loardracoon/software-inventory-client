import { expect, test, type Page } from "@playwright/test";

// Every route renders its heading for a signed-in admin, without uncaught errors or console errors.

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function expectPage(page: Page, path: string, heading: string | RegExp) {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
}

const ROUTES: [string, string][] = [
  ["/", "Overview"],
  ["/computers", "Computers"],
  ["/software", "Software"],
  ["/policies", "Policies"],
  ["/changes", "Changes"],
  ["/scans", "Scans"],
  ["/settings", "Settings"],
  ["/no-such-page", "Page not found"],
];

for (const [path, heading] of ROUTES) {
  test(`${path} renders "${heading}"`, async ({ page }) => {
    const errors = watchErrors(page);
    await expectPage(page, path, heading);
    await page.waitForLoadState("networkidle");
    expect(errors).toEqual([]);
  });
}

test("a computer and a software title open from their lists", async ({ page }) => {
  const errors = watchErrors(page);
  await expectPage(page, "/computers", "Computers");
  const computer = page.getByRole("table", { name: "Computers" }).getByRole("link").first();
  const hostname = (await computer.textContent())!.trim();
  await computer.click();
  await expect(page.getByRole("heading", { level: 1, name: hostname })).toBeVisible();

  await expectPage(page, "/software", "Software");
  const title = page.getByRole("table", { name: "Software titles" }).getByRole("link").first();
  const name = (await title.textContent())!.trim();
  await title.click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(errors).toEqual([]);
});

test("a saved search in the sidebar opens Software with its filters", async ({ page }) => {
  await expectPage(page, "/", "Overview");
  await page.getByRole("link", { name: /Remote access & tunnels/ }).click();
  await expect(page).toHaveURL(/\/software\?category=remote-access%2Cproxy-and-tunnel/);
  await expect(page.getByLabel("Category")).toHaveValue("remote-access,proxy-and-tunnel");
});
