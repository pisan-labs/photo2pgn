// Fixing moves without typing: on the board, from the move list, and with the panel's buttons.
import { expect, test } from "@playwright/test";

test("change a move on the board: take the piece back and put it somewhere else", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the demo game instead" }).click();
  // The smudged last move is the engine's best guess; the review opens on it.
  await expect(page.locator(".cell.st-guess")).toHaveText("Rd8#");
  await expect(page.getByLabel("Likeliest moves").locator(".chip").first()).toHaveText("Keep Rd8#");
  // Tap the rook that moved: it goes back to d1 and shows where it can go.
  await page.getByRole("button", { name: "d8 white r" }).click();
  await expect(page.getByText("Tap a square to move it there, or the piece again to put it back.")).toBeVisible();
  await expect(page.getByRole("button", { name: "d1 white r" })).toBeVisible();
  // Tap the rook again: put back, nothing changed.
  await page.getByRole("button", { name: "d1 white r" }).click();
  await expect(page.getByRole("button", { name: "d8 white r" })).toBeVisible();
  await expect(page.locator(".cell.st-guess")).toHaveCount(1);
  // Lift it and play Rd8 for real: the move is now the person's own.
  await page.getByRole("button", { name: "d8 white r" }).click();
  await page.getByRole("button", { name: /^d8/ }).click();
  await expect(page.locator(".cell.st-guess")).toHaveCount(0);
  await expect(page.locator(".pgn textarea")).toHaveValue(/Nxb8 17\. Rd8# 1-0/);

  await page.getByRole("button", { name: "Flip board" }).click();
  await expect(page.locator(".board .sq").first()).toHaveClass(/light|dark/);
});

test("another piece of the same side can be played instead", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the demo game instead" }).click();
  // 2. Nf3 was read; play 2. Nc3 instead by lifting the other knight.
  await page.locator(".cell", { hasText: /^Nf3$/ }).click();
  await page.getByRole("button", { name: "b1 white n" }).click();
  await page.getByRole("button", { name: /^c3/ }).click();
  await expect(page.locator(".cell").nth(2)).toHaveText("Nc3");
  await page.getByRole("button", { name: "Undo my change" }).click();
  await expect(page.locator(".cell").nth(2)).toHaveText("Nf3");
});

test("click the selected move again for its other moves, likeliest first", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the demo game instead" }).click();
  const qe6 = page.locator(".cell", { hasText: /^Qe6$/ });
  await qe6.click();
  await expect(page.getByRole("group", { name: /Other moves for/ })).toHaveCount(0);
  await qe6.click();
  const pop = page.getByRole("group", { name: "Other moves for 14..." });
  await expect(pop.locator(".chip")).toHaveCount(6);
  // The panel's three are the popup's first three.
  const first3 = (await pop.locator(".chip").allTextContents()).slice(0, 3);
  expect(await page.getByLabel("Likeliest moves").locator(".chip").allTextContents()).toEqual(["Keep Qe6", ...first3]);
  await pop.getByRole("button", { name: /All legal moves/ }).click();
  expect(await pop.locator(".chip").count()).toBeGreaterThan(6);
  await pop.locator(".chip", { hasText: /^Qd6$/ }).click();
  await expect(page.locator(".cell", { hasText: /^Qd6$/ })).toBeVisible();
  await expect(page.getByRole("group", { name: /Other moves for/ })).toHaveCount(0);
});

test("add a move the player forgot to write, then undo it", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the demo game instead" }).click();
  // Mark a move as missing before 1...e5 on purpose (e6, so e5 becomes White's 2. e5), then undo it.
  await page.locator(".cell", { hasText: /^e5$/ }).first().click();
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "A move is missing before this one" }).click();
  await page.getByLabel(/The missing move/).fill("e6");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.locator(".cell .ins").first()).toBeVisible();
  await page.getByRole("button", { name: "Undo my change" }).click();
  await expect(page.locator(".cell .ins")).toHaveCount(0);
});

test("drag a piece straight to its new square, and the board shows it at once", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the demo game instead" }).click();
  // 8...c6 as read; drag the pawn from c6 to c5 to play 8...c5 instead.
  await page.locator(".cell", { hasText: /^c6$/ }).click();
  const center = async (label: string) => {
    const b = (await page.getByRole("button", { name: label }).boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const a = await center("c6 black p");
  const b = await center("c5");
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await expect(page.locator(".drag-pc")).toBeVisible();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  // At once, before the game is checked again: the pawn is on c5, not back on c6.
  const now = await page.evaluate(() => ({
    c5: Boolean(document.querySelector('[aria-label="c5 black p"]')),
    c6: Boolean(document.querySelector('[aria-label="c6 black p"]')),
  }));
  expect(now).toEqual({ c5: true, c6: false });
  await expect(page.locator(".cell", { hasText: /^c5$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "c5 black p" })).toBeVisible();
  await page.getByRole("button", { name: "Undo my change" }).click();
  await expect(page.locator(".cell", { hasText: /^c6$/ })).toBeVisible();
});

test("a drop on a square the piece cannot reach changes nothing", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the demo game instead" }).click();
  await page.locator(".cell", { hasText: /^c6$/ }).click();
  const box = async (label: string) => (await page.getByRole("button", { name: label }).boundingBox())!;
  const a = await box("c6 black p");
  const b = await box("h3");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "c6 black p" })).toBeVisible();
  await expect(page.locator(".cell", { hasText: /^c6$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo my change" })).toHaveCount(0);
});
