// The game viewer: board left, moves right, buttons to step through the game.
import { devices, expect, test } from "@playwright/test";

test("step through the game with the buttons, the keys and the move list", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Try the demo game instead" }).click();
  const caption = page.locator(".gv-board figcaption");

  await page.getByRole("button", { name: "Go to the start" }).click();
  await expect(caption).toHaveText("Starting position");
  await expect(page.getByRole("button", { name: "Previous move" })).toBeDisabled();
  await expect(page.locator(".move-panel")).toContainText("Starting position");

  await page.getByRole("button", { name: "Next move" }).click();
  await expect(caption).toHaveText("After 1. e4");
  await page.keyboard.press("ArrowRight");
  await expect(caption).toHaveText("After 1... e5");
  await expect(page.locator(".cell.selected")).toHaveText("e5");

  await page.getByRole("button", { name: "Go to the end" }).click();
  await expect(caption).toHaveText("After 17. Rd8#");
  await expect(page.getByRole("button", { name: "Next move" })).toBeDisabled();
  await page.keyboard.press("Home");
  await expect(caption).toHaveText("Starting position");

  await page.locator(".cell", { hasText: /^Nf3$/ }).click();
  await expect(caption).toHaveText("After 2. Nf3");
  await expect(page.locator(".move-panel .mp-head strong")).toHaveText("2. Nf3");

  // Board on the left; the moves to its right, then the buttons, then the selected move.
  const board = (await page.locator(".gv-board .board").boundingBox())!;
  const moves = (await page.locator(".gv-moves").boundingBox())!;
  const controls = (await page.locator(".gv-controls").boundingBox())!;
  expect(moves.x).toBeGreaterThan(board.x + board.width);
  const panel = (await page.locator(".gv-panel").boundingBox())!;
  expect(panel.x).toBeGreaterThan(board.x + board.width);
  expect(panel.y).toBeGreaterThanOrEqual(controls.y + controls.height);
});

test("on a phone: the board, the buttons, the selected move, then the moves", async ({ browser }) => {
  const pixel: Partial<(typeof devices)[string]> = { ...devices["Pixel 7"] };
  delete pixel.defaultBrowserType; // Chromium only here
  const page = await (await browser.newContext(pixel)).newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "Try the demo game instead" }).click();
  const board = (await page.locator(".gv-board .board").boundingBox())!;
  const controls = (await page.locator(".gv-controls").boundingBox())!;
  const moves = (await page.locator(".gv-moves").boundingBox())!;
  expect(controls.y).toBeGreaterThan(board.y + board.height);
  const panel = (await page.locator(".gv-panel").boundingBox())!;
  expect(panel.y).toBeGreaterThan(controls.y + controls.height);
  expect(moves.y).toBeGreaterThan(panel.y + panel.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
});
