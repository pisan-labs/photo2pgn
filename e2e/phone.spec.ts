// The phone flow: a sideways photo is turned and cropped by touch, photos
// shared from the gallery arrive in the app, and the app can be installed.
import { devices, expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { DEMO_EXTRACTION } from "../src/demo/sample";

// Only Chromium is installed: use the phones' screens, touch and user agents in it.
function phone(name: string) {
  const settings: Partial<(typeof devices)[string]> = { ...devices[name] };
  delete settings.defaultBrowserType;
  return settings;
}

const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };

test.describe("on a phone", () => {
  test.use(phone("iPhone 13"));

  test("a sideways photo opens the editor; turn, crop by touch, then read", async ({ page }) => {
    let sent = 0;
    await page.route("https://api.anthropic.com/**", async (route) => {
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      sent++;
      return route.fulfill({
        status: 200,
        headers: { ...cors, "content-type": "application/json" },
        body: JSON.stringify({
          id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "tool_use", stop_sequence: null,
          content: [{ type: "tool_use", id: "t", name: "record_scoresheet", input: DEMO_EXTRACTION }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      });
    });
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Take photo/ })).toBeVisible();
    await page.setInputFiles('input[type=file][multiple]', "e2e/fixtures/scoresheet-sideways.png");

    const editor = page.getByRole("dialog", { name: "Turn and crop the photo" });
    await expect(editor).toBeVisible();
    await editor.getByRole("button", { name: "Turn right" }).click();
    const img = editor.locator(".editor-frame img");
    await expect(img).toBeVisible();
    // The turned preview loads a moment later: wait until the photo stands upright.
    await expect
      .poll(async () => {
        const b = await img.boundingBox();
        return Boolean(b && b.height > b.width);
      })
      .toBe(true);
    const box = (await img.boundingBox())!;

    // Drag the top-left handle inwards with a finger.
    const handle = editor.locator(".handle.nw");
    const h = (await handle.boundingBox())!;
    await handle.dispatchEvent("pointerdown", { pointerId: 1, clientX: h.x + 14, clientY: h.y + 14, isPrimary: true });
    await editor.locator(".editor-frame").dispatchEvent("pointermove", { pointerId: 1, clientX: h.x + 14 + box.width * 0.1, clientY: h.y + 14 + box.height * 0.1 });
    await editor.locator(".editor-frame").dispatchEvent("pointerup", { pointerId: 1 });
    const crop = (await editor.locator(".crop").boundingBox())!;
    expect(crop.width).toBeLessThan(box.width * 0.95);
    await editor.getByRole("button", { name: "Done" }).click();
    await expect(editor).toBeHidden();

    await page.getByRole("radio", { name: /My own Anthropic API key/ }).check();
    await page.getByLabel("API key", { exact: true }).fill("sk-ant-phone-0123456789");
    const read = page.getByRole("button", { name: "Read scoresheet" });
    await read.scrollIntoViewIfNeeded();
    await read.tap();
    await expect(page.getByRole("heading", { name: /Check the moves/ })).toBeVisible();
    expect(sent).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});

test.describe("installed app", () => {
  test.use(phone("Pixel 7"));

  test("photos shared from the gallery arrive as pages", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    // Reload so the service worker controls the page, as it does in the installed app.
    await page.reload();
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    const png = readFileSync("e2e/fixtures/scoresheet.png").toString("base64");
    const status = await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const form = new FormData();
      form.append("photos", new File([bytes], "sheet.png", { type: "image/png" }));
      const res = await fetch("/share-target", { method: "POST", body: form, redirect: "manual" });
      return res.type;
    }, png);
    expect(status).toBe("opaqueredirect");
    await page.goto("/?shared=1");
    await expect(page.getByText("Page 1")).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test("the manifest makes it installable", async ({ page, request }) => {
    const manifest = await (await request.get("/manifest.webmanifest")).json();
    expect(manifest).toMatchObject({ display: "standalone", start_url: "/", share_target: { action: "/share-target", method: "POST" } });
    for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true);
    await page.goto("/");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  });
});
