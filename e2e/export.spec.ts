// Sending the game on: Lichess in one click (faked here, nothing is imported).
import { expect, test } from "@playwright/test";

test("Open in Lichess imports the PGN and opens the game", async ({ page, context }) => {
  let posted = "";
  await context.route("https://lichess.org/**", async (route) => {
    const req = route.request();
    if (req.url().endsWith("/api/import")) {
      posted = new URLSearchParams(req.postData() ?? "").get("pgn") ?? "";
      return route.fulfill({
        status: 200,
        headers: { "access-control-allow-origin": "*", "content-type": "application/json" },
        body: JSON.stringify({ id: "AbCd1234", url: "https://lichess.org/AbCd1234" }),
      });
    }
    return route.fulfill({ status: 200, contentType: "text/html", body: "<title>Lichess game</title>" });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Try the demo game instead" }).click();
  const [tab] = await Promise.all([context.waitForEvent("page"), page.getByRole("button", { name: "Open in Lichess" }).click()]);
  await tab.waitForURL("https://lichess.org/AbCd1234");
  expect(posted).toContain('[White "Morphy, Paul"]');
  expect(posted).toContain("1. e4 e5");
});

test("without a share sheet, Email opens a prefilled message", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the demo game instead" }).click();
  const href = await page.getByRole("link", { name: "Email" }).getAttribute("href");
  expect(href).toMatch(/^mailto:\?subject=PGN%3A%20Morphy/);
  expect(decodeURIComponent(href!)).toContain("1. e4 e5");
});
