// The main flow in a real browser: photo, own key, reading (Anthropic faked),
// review, fixing the red move, PGN download. Plus the demo and the footer.
import { expect, test, type Page } from "@playwright/test";
import { DEMO_EXTRACTION } from "../src/demo/sample";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "POST, OPTIONS",
};

async function fakeAnthropic(page: Page, seen: { body?: Record<string, unknown>; key?: string }) {
  await page.route("https://api.anthropic.com/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    seen.body = req.postDataJSON();
    seen.key = req.headers()["x-api-key"] ?? req.headers()["authorization"];
    return route.fulfill({
      status: 200,
      headers: { ...cors, "content-type": "application/json" },
      body: JSON.stringify({
        id: "msg_e2e",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [{ type: "tool_use", id: "t1", name: "record_scoresheet", input: DEMO_EXTRACTION }],
        stop_reason: "tool_use",
        stop_sequence: null,
        usage: { input_tokens: 1500, output_tokens: 2500 },
      }),
    });
  });
}

test("photo to PGN with the visitor's own key", async ({ page }) => {
  const seen: { body?: Record<string, unknown>; key?: string } = {};
  await fakeAnthropic(page, seen);
  await page.goto("/");
  // No sign-in in this preview: the own key is the one way in, and the photo step waits for it.
  await expect(page.getByRole("heading", { name: "1. Your Anthropic API key" })).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(page.getByText("Enter your API key first")).toBeVisible();
  await expect(page.getByRole("button", { name: /Take photo/ })).toBeDisabled();
  await expect(page.getByText(/scoresheet that reads well|Print a free scoresheet/)).toHaveCount(0);
  await page.getByLabel("API key", { exact: true }).fill("sk-ant-e2e-0123456789");
  await expect(page.getByRole("button", { name: /Take photo/ })).toBeEnabled();

  await page.setInputFiles('input[type=file][multiple]', "e2e/fixtures/scoresheet.png");
  await expect(page.getByText("Page 1")).toBeVisible();
  await page.getByRole("button", { name: "Read scoresheet" }).click();

  await expect(page.getByRole("heading", { name: /Check the moves/ })).toBeVisible();
  expect(seen.key).toContain("sk-ant-e2e-0123456789");
  const content = (seen.body?.messages as { content: { type: string; source?: { data: string } }[] }[])[0].content;
  const image = content.find((b) => b.type === "image")!;
  expect(image.source!.data.length).toBeLessThan(900_000);
  expect(JSON.stringify(seen.body).length).toBeLessThan(1_000_000);

  // Nothing stops the game: the smudged last move is a best guess to check.
  await expect(page.locator(".legend")).toContainText("1 to check");
  await expect(page.locator(".pgn textarea")).toHaveValue(/16\. Qb8\+ Nxb8 17\. Rd8# 1-0/);
  await page.locator(".cell.st-guess").click();
  await page.getByRole("button", { name: "Keep Rd8#" }).click();
  await expect(page.locator(".cell.st-guess")).toHaveCount(0);
  await expect(page.locator(".pgn textarea")).toHaveValue(/16\. Qb8\+ Nxb8 17\. Rd8# 1-0/);

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /^Download / }).click()]);
  expect(download.suggestedFilename()).toBe("Morphy-DukeKarlCountIsouard-1858.pgn");
});

test("the demo works without any key, and the HintWise footer is there", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the demo game instead" }).click();
  await expect(page.getByRole("heading", { name: /Check the moves/ })).toBeVisible();
  await expect(page.locator(".cell.st-fixed").first()).toBeVisible();
  const footer = await page.evaluate(() => document.querySelector("site-footer")?.shadowRoot?.textContent ?? "");
  expect(footer).toContain("builder@hintwise.org");
});

test("fits a phone screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Try the demo game instead" }).click();
  await expect(page.getByRole("heading", { name: /Check the moves/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("a read game is kept in My games and opens again; the demo is not saved", async ({ page }) => {
  await fakeAnthropic(page, {});
  await page.goto("/");
  await page.getByRole("button", { name: "Try the demo game instead" }).click();
  await page.getByRole("button", { name: "Start over" }).click();
  await expect(page.getByRole("heading", { name: "My games" })).toHaveCount(0);

  await page.getByLabel("API key", { exact: true }).fill("sk-ant-e2e-0123456789");
  await page.setInputFiles('input[type=file][multiple]', "e2e/fixtures/scoresheet.png");
  await page.getByRole("button", { name: "Read scoresheet" }).click();
  await expect(page.getByRole("heading", { name: /Check the moves/ })).toBeVisible();
  await page.locator(".notes textarea").fill("Round 3, board 2");
  await page.waitForTimeout(1200); // autosave
  await page.reload();

  await expect(page.getByRole("heading", { name: "My games" })).toBeVisible();
  await expect(page.getByText("Saved on this device only.")).toBeVisible();
  await page.getByRole("button", { name: /^Morphy, Paul vs Duke Karl/ }).click();
  await expect(page.getByRole("heading", { name: /Check the moves/ })).toBeVisible();
  await expect(page.locator(".notes textarea")).toHaveValue("Round 3, board 2");
  await expect(page.locator(".pgn textarea")).toHaveValue(/\{Round 3, board 2\} 1\. e4/);

  await page.getByRole("button", { name: "Start over" }).click();
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: /^Delete Morphy/ }).click();
  await expect(page.getByRole("heading", { name: "My games" })).toHaveCount(0);
});


test("several sheets at once: each is read as its own game and saved in My games", async ({ page }) => {
  let calls = 0;
  page.on("request", (r) => {
    if (r.url().startsWith("https://api.anthropic.com/") && r.method() === "POST") calls++;
  });
  await fakeAnthropic(page, {});
  await page.goto("/");
  await page.getByLabel("API key", { exact: true }).fill("sk-ant-e2e-0123456789");
  const sheet = "e2e/fixtures/scoresheet.png";
  await page.setInputFiles("input[type=file][multiple]", [sheet, sheet, sheet]);
  await expect(page.getByRole("heading", { name: /^Sheet \d$/ })).toHaveCount(3);

  // The third photo is the second page of the second game.
  await page.getByRole("listitem", { name: "Sheet 3" }).getByRole("button", { name: "Same game as sheet 2" }).click();
  await expect(page.getByRole("heading", { name: /^Sheet \d$/ })).toHaveCount(2);
  await expect(page.getByRole("img", { name: "Sheet 2, page 2" })).toBeVisible();
  await page.getByRole("button", { name: "Read 2 scoresheets" }).click();

  const batch = page.getByRole("region", { name: "Sheets being read" });
  await expect(batch).toContainText("Done: 2 of 2 read");
  await expect(batch).toContainText("(2 pages)");
  expect(calls).toBe(2);
  await expect(page.getByRole("heading", { name: "My games" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Morphy, Paul vs Duke Karl/ })).toHaveCount(2);

  await batch.getByRole("button", { name: /^Open sheet 2/ }).click();
  await expect(page.getByRole("heading", { name: /Check the moves/ })).toBeVisible();
  await expect(page.locator(".pgn textarea")).toHaveValue(/17\. Rd8# 1-0/);
  await page.getByRole("button", { name: "Start over" }).click();
  await batch.getByRole("button", { name: "Close" }).click();
  await expect(batch).toHaveCount(0);
});

test("the terms, refund and privacy pages are published and linked from the footer", async ({ page }) => {
  await page.goto("/");
  for (const [slug, title] of [["terms", "Terms of service"], ["refunds", "Refund policy"], ["privacy", "Privacy policy"]]) {
    await expect(page.locator("footer.foot").getByRole("link", { name: slug[0].toUpperCase() + slug.slice(1) })).toHaveAttribute("href", `/${slug}`);
    // vite preview has no Netlify redirects: the files themselves.
    await page.goto(`/${slug}.html`);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.locator("site-footer")).toHaveCount(1);
    await page.goto("/");
  }
});

test("the prices are public at /pricing, with buying not open yet", async ({ page }) => {
  await page.goto("/");
  await page.locator("footer.foot").getByRole("link", { name: "Pricing" }).click();
  await expect(page).toHaveURL(/\/pricing$/);
  const buy = page.getByRole("region", { name: "Buy credits" });
  await expect(buy).toContainText("20 credits for US$5");
  await expect(buy).toContainText("50 credits for US$10");
  await expect(buy).toContainText("Buying opens soon");
  await expect(buy.getByRole("button", { name: "Coming soon" })).toHaveCount(2);
  for (const b of await buy.getByRole("button", { name: "Coming soon" }).all()) await expect(b).toBeDisabled();
  await expect(buy.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
  await buy.getByRole("button", { name: "Close" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(buy).toHaveCount(0);
});
