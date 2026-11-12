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
  await expect(page.getByRole("heading", { name: "Starting position" })).toBeVisible();

  await page.getByRole("button", { name: "Next move" }).click();
  await expect(caption).toHaveText("After 1. e4");
  await page.keyboard.press("ArrowRight");
  await expect(caption).toHaveText("After 1... e5");
  await expect(page.locator(".cell.selected")).toHaveText("e5");

  await page.getByRole("button", { name: "Go to the end" }).click();
  await expect(caption).toHaveText(/^Not checked yet: fix the move in red/);
  await expect(page.getByRole("button", { name: "Next move" })).toBeDisabled();
  await page.keyboard.press("Home");
  await expect(caption).toHaveText("Starting position");

  await page.locator(".cell", { hasText: /^Nf3$/ }).click();
  await expect(caption).toHaveText("After 2. Nf3");
  await expect(page.locator(".detail-panel h2")).toHaveText("2. Nf3");

  // Board on the left, the moves to its right, the buttons along the board's bottom edge.
  const board = (await page.locator(".gv-board .board").boundingBox())!;
  const moves = (await page.locator(".gv-moves").boundingBox())!;
  const controls = (await page.locator(".gv-controls").boundingBox())!;
  expect(moves.x).toBeGreaterThan(board.x + board.width);
  expect(Math.abs(controls.y + controls.height - (board.y + board.height))).toBeLessThan(2);
});

test("on a phone: the board, then the buttons, then the moves", async ({ browser }) => {
  const pixel: Partial<(typeof devices)[string]> = { ...devices["Pixel 7"] };
  delete pixel.defaultBrowserType; // Chromium only here
  const page = await (await browser.newContext(pixel)).newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "Try the demo game instead" }).click();
  const board = (await page.locator(".gv-board .board").boundingBox())!;
  const controls = (await page.locator(".gv-controls").boundingBox())!;
  const moves = (await page.locator(".gv-moves").boundingBox())!;
  expect(controls.y).toBeGreaterThan(board.y + board.height);
  expect(moves.y).toBeGreaterThan(controls.y + controls.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
});
