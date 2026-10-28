import { expect, test, type Locator, type Page } from "@playwright/test";

// Phase 9 end to end, on a stack seeded with e2e/fixtures/policy-seed.sql (Adobe Acrobat 23.008 and
// 25.001, Adobe Photoshop, 7-Zip, Chrome Remote Desktop on two computers) and no policy yet. The tests run in order and build on each
// other: two rules, reorder by mouse and by keyboard (the title tester follows the draft), publish,
// then the dashboard, Software, Computer and Changes screens.

test.describe.configure({ mode: "serial" });

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}

const rulesTable = (page: Page) => page.getByRole("table", { name: /Policy rules/ });
const ruleOrder = async (page: Page) => (await rulesTable(page).locator("tbody tr td:nth-child(4) a").allTextContents()).map((s) => s.trim());

async function testerResult(page: Page, title: string, version: string): Promise<Locator> {
  await page.getByLabel("Find a title").fill(title);
  await page.getByLabel("Title", { exact: true }).selectOption({ label: `${title} · Program` });
  await page.getByLabel("Installed version").selectOption({ value: version });
  return page.locator("[aria-live=polite]").filter({ hasText: "sets the class" }).or(page.getByText("No rule matches: the default class applies."));
}

async function addRule(page: Page, rule: { name: string; cls: string; field: string; operator: string; value: string; owner: string; extra?: (page: Page) => Promise<void> }) {
  await page.goto("/policies");
  await page.getByRole("link", { name: "New rule" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "New rule" })).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill(rule.name);
  await page.getByRole("radio", { name: rule.cls, exact: true }).click();
  await page.getByLabel("Field of condition 1").selectOption({ label: rule.field });
  await page.getByLabel("Operator of condition 1").selectOption({ label: rule.operator });
  await page.getByLabel("Value of condition 1").fill(rule.value);
  await page.getByLabel("Owner", { exact: true }).fill(rule.owner);
  if (rule.extra) await rule.extra(page);
  await expect(page.getByText(/this rule sets the class of/)).toBeVisible();
  await page.getByRole("button", { name: "Save rule" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Policies" })).toBeVisible();
  await expect(rulesTable(page).getByRole("link", { name: rule.name })).toBeVisible();
}

test("an admin writes two rules into a draft", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/policies");
  await expect(page.getByText("No policy is published yet.", { exact: false }).first()).toBeVisible();

  await addRule(page, { name: "Adobe suite", cls: "Sanctioned", field: "Vendor / publisher", operator: "is (exact match)", value: "Adobe", owner: "IT Operations" });
  await addRule(page, {
    name: "Old Acrobat",
    cls: "Unsanctioned",
    field: "App name",
    operator: "contains",
    value: "Acrobat",
    owner: "Security team",
    extra: async (p) => {
      await p.getByRole("button", { name: "Add condition" }).click();
      await p.getByLabel("Field of condition 2").selectOption({ label: "Version" });
      await p.getByLabel("Operator of condition 2").selectOption({ label: "<" });
      await p.getByLabel("Value of condition 2").fill("24");
      await p.getByLabel("Reason").fill("Out of vendor support (CIS 2.2).");
      await p.getByLabel("Remediation").fill("Update to 24 or later.");
    },
  });

  await expect(page.getByText(/Draft version 1 · 2 changes/)).toBeVisible();
  expect(await ruleOrder(page)).toEqual(["Adobe suite", "Old Acrobat"]);
  await expect(await testerResult(page, "Adobe Acrobat", "23.008")).toContainText("Rule 1 · Adobe suite");
  expect(errors).toEqual([]);
});

test("reordering by mouse changes the title tester before publishing", async ({ page }) => {
  await page.goto("/policies");
  await expect(rulesTable(page).getByRole("link", { name: "Old Acrobat" })).toBeVisible();
  await page.waitForLoadState("networkidle"); // the cards above the table settle first
  await rulesTable(page).scrollIntoViewIfNeeded(); // the mouse only reaches what is on screen
  const handle = (await page.getByRole("button", { name: "Reorder rule 2: Old Acrobat" }).boundingBox())!;
  const firstRow = (await rulesTable(page).locator("tbody tr").first().boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  for (let y = handle.y + handle.height / 2; y > firstRow.y + 5; y -= 8) await page.mouse.move(handle.x + handle.width / 2, y);
  await page.mouse.up();

  await expect.poll(() => ruleOrder(page)).toEqual(["Old Acrobat", "Adobe suite"]);
  await expect(await testerResult(page, "Adobe Acrobat", "23.008")).toContainText("Rule 1 · Old Acrobat");
  await page.reload();
  await expect.poll(() => ruleOrder(page)).toEqual(["Old Acrobat", "Adobe suite"]); // stored in the draft
});

test("reordering by keyboard: Space, arrows, Space; Escape cancels", async ({ page }) => {
  await page.goto("/policies");
  await expect(rulesTable(page).getByRole("link", { name: "Old Acrobat" })).toBeVisible();
  await page.getByRole("button", { name: "Reorder rule 1: Old Acrobat" }).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect.poll(() => ruleOrder(page)).toEqual(["Old Acrobat", "Adobe suite"]);

  await page.getByRole("button", { name: "Reorder rule 1: Old Acrobat" }).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Space");
  await expect.poll(() => ruleOrder(page)).toEqual(["Adobe suite", "Old Acrobat"]);
  await expect(await testerResult(page, "Adobe Acrobat", "23.008")).toContainText("Rule 1 · Adobe suite");

  // Back to the order the next tests expect, with the row menu this time.
  await page.getByRole("button", { name: "Actions for rule 2: Old Acrobat" }).click();
  await page.getByRole("menuitem", { name: "Move to top" }).click();
  await expect.poll(() => ruleOrder(page)).toEqual(["Old Acrobat", "Adobe suite"]);
});

test("publishing classifies every installed version", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/policies");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Policy version 1 published")).toBeVisible();
  await expect(page.getByText(/Draft version/)).toHaveCount(0);
  // Acrobat (by its 23.008 installation), 7-Zip and Chrome Remote Desktop (default class); Photoshop is sanctioned.
  await expect(page.getByRole("link", { name: /^Unsanctioned: 3 titles, 75%/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Sanctioned: 1 titles, 25%/ })).toBeVisible();

  await page.goto("/");
  const card = page.getByText("Application policy", { exact: true }).locator("xpath=ancestor::*[@data-slot='card'][1]");
  await expect(card.getByText("3 titles are unsanctioned, and 2 titles match no rule yet.")).toBeVisible();
  const legend = card.getByRole("row", { name: /Unsanctioned/ });
  await expect(legend).toContainText("3 · 75%");
  await expect(legend).toContainText("4 · 67%");

  await page.goto("/software?policy=unsanctioned-app");
  const table = page.getByRole("table", { name: "Software titles" });
  await expect(table.getByRole("link", { name: "Adobe Acrobat" })).toBeVisible();
  await expect(table.getByRole("link", { name: "Old Acrobat" })).toBeVisible();
  await expect(table.getByText("Mixed versions")).toBeVisible();
  await expect(page.getByLabel("Policy class")).toHaveValue("unsanctioned-app");
  await page.waitForLoadState("networkidle");
  expect(errors).toEqual([]);
});

test("a computer shows the class of each installed version", async ({ page }) => {
  await page.goto("/computers");
  await page.getByRole("table", { name: "Computers" }).getByRole("link", { name: "E2E-PC-OLD" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "E2E-PC-OLD" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Unsanctioned" }).first()).toBeVisible();
});

test("a second publish records class changes", async ({ page }) => {
  await page.goto("/policies");
  await page.getByRole("switch", { name: "Rule 1 Old Acrobat enabled" }).click();
  await expect(page.getByText(/Draft version 2 · 1 change/)).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Policy version 2 published")).toBeVisible();

  await page.goto("/changes");
  await page.getByRole("tab", { name: "Class changed" }).click();
  const table = page.getByRole("table", { name: "Policy class changes" });
  await expect(table.getByRole("row", { name: /Adobe Acrobat.*23\.008/ })).toContainText("Sanctioned");
});

for (const [width, height] of [
  [1360, 900],
  [390, 844],
] as const) {
  test(`policy screens fit ${width} px without horizontal page scroll`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width, height });
    for (const path of ["/", "/policies", "/policies/rules/new?position=1", "/software?policy=sanctioned-app", "/changes"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${path} at ${width}px`).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `test-results/policy-${width}-${path.replace(/[^a-z]+/g, "-")}.png`, fullPage: true });
    }
    expect(errors).toEqual([]);
  });
}
