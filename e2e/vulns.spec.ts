import { expect, test, type Page } from "@playwright/test";

// Phase 10b end to end, read only, on the stack of policy.spec.ts after a Dictionary Hub sync from the
// mock Hub (scripts/mock-dictionary-hub.mjs): its mock CVE-2099-0003 (known exploited, fixed in 24.0)
// affects Adobe Acrobat 23.008 on E2E-PC-OLD and not 25.001 on E2E-PC-NEW.

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}

test("Software filters known exploited CVEs and the title page lists them per version", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/software?vuln=kev");
  const table = page.getByRole("table", { name: "Software titles" });
  const row = table.getByRole("row").filter({ hasText: "Adobe Acrobat" });
  await expect(row).toBeVisible();
  await expect(row.getByText("Known exploited")).toBeVisible();
  await expect(row.getByText("1 CVE")).toBeVisible();
  await expect(table.getByRole("row").filter({ hasText: "7-Zip" })).toHaveCount(0);

  await row.getByRole("link", { name: "Adobe Acrobat" }).click();
  const card = page.getByRole("list", { name: "Known vulnerabilities" });
  await expect(card.getByRole("link", { name: /CVE-2099-0003/ })).toBeVisible();
  await expect(card.getByText(/Affects installed version 23\.008 on 1 computer/)).toBeVisible();
  await expect(card.getByText("24.0", { exact: true })).toBeVisible();
  const computers = page.getByRole("table", { name: "Computers with this title" });
  await expect(computers.getByRole("row").filter({ hasText: "E2E-PC-OLD" }).getByText("Known exploited")).toBeVisible();
  await expect(computers.getByRole("row").filter({ hasText: "E2E-PC-NEW" }).getByText("Known exploited")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Overview and Changes show the new known exploited CVE", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.getByRole("link", { name: /Known exploited CVEs/ })).toContainText("1");
  await expect(page.getByText("1 installation on 1 computer")).toBeVisible();

  await page.goto("/changes");
  await page.getByRole("tab", { name: "New CVE" }).click();
  const events = page.getByRole("table", { name: "New CVEs" });
  await expect(events.getByRole("row").filter({ hasText: "CVE-2099-0003" }).first()).toContainText("23.008");
  expect(errors).toEqual([]);
});

test("the rule editor offers the vulnerability fields", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/policies/rules/new");
  await page.getByLabel("Field of condition 1").selectOption({ label: "Known exploited (CISA KEV)" });
  await expect(page.getByLabel("Value of condition 1")).toHaveValue("true");
  await page.getByLabel("Field of condition 1").selectOption({ label: "Highest CVSS score" });
  await page.getByLabel("Value of condition 1").fill("11");
  await expect(page.getByText("Enter a number from 0 to 10").first()).toBeVisible();
  expect(errors).toEqual([]);
});
