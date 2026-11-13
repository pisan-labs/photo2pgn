// Fixing moves without typing: on the board, and with the editor's buttons.
import { expect, test } from "@playwright/test";

test("settle the move to check by playing it on the board, then add a missing move", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the demo game instead" }).click();
  // The smudged last move is the engine's best guess; the review opens on it.
  await expect(page.locator(".cell.st-guess")).toHaveText("Rd8#");
  await expect(page.getByLabel("Best guesses").locator(".chip").first()).toHaveText("Rd8#");
  await page.getByRole("button", { name: "Change it on the board" }).click();
  await expect(page.getByText("White to move: tap a piece, then its square")).toBeVisible();
  await page.getByRole("button", { name: "d1 white r" }).click();
  await page.getByRole("button", { name: /^d8/ }).click();
  await expect(page.locator(".cell.st-guess")).toHaveCount(0);
  await expect(page.locator(".pgn textarea")).toHaveValue(/Nxb8 17\. Rd8# 1-0/);

  await page.getByRole("button", { name: "Flip board" }).click();
  await expect(page.locator(".board .sq").first()).toHaveClass(/light|dark/);

  // Mark a move as missing before 1...e5 on purpose (e6, so e5 becomes White's 2. e5), then undo it.
  await page.locator(".cell", { hasText: /^e5$/ }).first().click();
  await page.getByRole("button", { name: "A move is missing before this one" }).click();
  await page.getByLabel(/The missing move/).fill("e6");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.locator(".cell .ins").first()).toBeVisible();
  await page.getByRole("button", { name: "Undo my change" }).click();
  await expect(page.locator(".cell .ins")).toHaveCount(0);
});
