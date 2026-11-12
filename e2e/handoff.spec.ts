// Chess TD opens photo2pgn to read one game; the checked game goes back.
// A fake Chess TD page is served on http://localhost:5173 (an allowed origin).
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { DEMO_EXTRACTION } from "../src/demo/sample";

const REF = "e2eRef0123456789abcd";
const CHESSTD = "http://localhost:5173";
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };

async function fakes(context: BrowserContext, chessTdPage: string) {
  await context.route("https://api.anthropic.com/**", (route) =>
    route.request().method() === "OPTIONS"
      ? route.fulfill({ status: 204, headers: cors })
      : route.fulfill({
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
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
        }),
  );
  await context.route(`${CHESSTD}/**`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: chessTdPage }));
}

function link(base: string) {
  const q = new URLSearchParams({
    from: "chesstd",
    v: "1",
    ref: REF,
    return: `${CHESSTD}/#/t/1/rounds/3/games?board=5`,
    white: "Morphy, Paul",
    black: "Allies",
    round: "3",
    board: "5",
    date: "1858-11-02",
  });
  return `${base}/?${q}`;
}

async function readAndCheck(page: Page) {
  await expect(page.getByText("For Chess TD: Morphy, Paul – Allies, round 3, board 5.")).toBeVisible();
  // The parameters leave the address bar once picked up.
  await expect.poll(() => new URL(page.url()).search).toBe("");
  await page.getByLabel("API key", { exact: true }).fill("sk-ant-e2e-0123456789");
  await page.setInputFiles("input[type=file][multiple]", "e2e/fixtures/scoresheet.png");
  await page.getByRole("button", { name: "Read scoresheet" }).click();
  await expect(page.getByRole("heading", { name: /Check the moves/ })).toBeVisible();
  // Chess TD's pairing wins over the handwriting.
  await expect(page.getByLabel("Black", { exact: true })).toHaveValue("Allies");
  await page.locator(".cell.st-illegal").click();
  await page.locator(".chip", { hasText: "Nxb8" }).click();
  await expect(page.locator(".cell.st-illegal")).toHaveCount(0);
}

test("back to the tab that opened it, by message", async ({ context, page, baseURL }) => {
  await fakes(
    context,
    `<!doctype html><title>Chess TD</title><script>
      window.got = [];
      addEventListener("message", (e) => {
        if (e.origin !== ${JSON.stringify(baseURL)}) return;
        window.got.push(e.data);
        if (e.data.type === "photo2pgn/result") e.source.postMessage({ type: "photo2pgn/received", v: 1, ref: e.data.ref }, e.origin);
      });
    </script><button id="read">Read on photo2pgn</button><script>
      document.getElementById("read").onclick = () => window.open(${JSON.stringify(link(baseURL!))}, "_blank");
    </script>`,
  );
  await page.goto(`${CHESSTD}/`);
  const [tab] = await Promise.all([page.waitForEvent("popup"), page.getByRole("button", { name: "Read on photo2pgn" }).click()]);
  await readAndCheck(tab);
  await tab.getByRole("button", { name: "Send to Chess TD" }).click();
  await expect(tab.getByText("Sent to Chess TD.")).toBeVisible();
  await expect(tab.getByRole("button", { name: "Send to Chess TD" })).toHaveCount(0);

  const got = await page.evaluate(() => (window as unknown as { got: Record<string, unknown>[] }).got);
  expect(got).toHaveLength(1);
  expect(got[0]).toMatchObject({ type: "photo2pgn/result", v: 1, ref: REF, white: "Morphy, Paul", black: "Allies", result: "1-0" });
  expect(got[0].pgn).toMatch(/\[Round "3"\][\s\S]*16\. Qb8\+ Nxb8 17\. Rd8# 1-0/);
  const warnings = got[0].warnings as { ply: number; kind: string }[];
  expect(warnings.length).toBeGreaterThan(0);
  expect(warnings.every((w) => w.ply > 0 && ["filled", "unsure", "illegal", "skipped"].includes(w.kind))).toBe(true);
});

test("no opener: back to Chess TD's page with the game in the hash", async ({ context, page, baseURL }) => {
  await fakes(context, "<!doctype html><title>Chess TD</title><p>Chess TD</p>");
  await page.goto(link(baseURL!));
  await readAndCheck(page);
  await page.getByRole("button", { name: "Send to Chess TD" }).click();
  await page.waitForURL(`${CHESSTD}/**`);
  const url = new URL(page.url());
  expect(url.hash.startsWith("#/t/1/rounds/3/games?board=5&photo2pgn=")).toBe(true);
  const payload = url.hash.split("photo2pgn=")[1];
  const msg = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  expect(msg).toMatchObject({ type: "photo2pgn/result", v: 1, ref: REF, white: "Morphy, Paul" });
});
