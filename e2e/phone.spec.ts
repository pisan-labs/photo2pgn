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
    // The photo step opens once there is a way to read it: here, the visitor's own key.
    await expect(page.getByRole("button", { name: /Take photo/ })).toBeDisabled();
    await page.getByLabel("API key", { exact: true }).fill("sk-ant-phone-0123456789");
    await expect(page.getByRole("button", { name: /Take photo/ })).toBeEnabled();
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

  test("photos shared from the gallery arrive, each as its own sheet", async ({ page }) => {
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
      for (const name of ["game-1.png", "game-2.png", "game-3.png"]) form.append("photos", new File([bytes], name, { type: "image/png" }));
      const res = await fetch("/share-target", { method: "POST", body: form, redirect: "manual" });
      return res.type;
    }, png);
    expect(status).toBe("opaqueredirect");
    await page.goto("/?shared=1");
    await expect(page).toHaveURL(/\/$/);
    // The shared photos wait until there is a way to read them, then arrive as three sheets.
    await expect(page.getByRole("heading", { name: /^Sheet \d$/ })).toHaveCount(0);
    await page.getByLabel("API key", { exact: true }).fill("sk-ant-phone-0123456789");
    await expect(page.getByRole("heading", { name: /^Sheet \d$/ })).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Read 3 scoresheets" })).toBeEnabled();
  });

  test("the manifest makes it installable", async ({ page, request }) => {
    const manifest = await (await request.get("/manifest.webmanifest")).json();
    expect(manifest).toMatchObject({ display: "standalone", start_url: "/", share_target: { action: "/share-target", method: "POST" } });
    for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true);
    await page.goto("/");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  });
});

test.describe("the install link on an iPhone", () => {
  test.use(phone("iPhone 13"));

  test("explains Share > Add to Home Screen, then goes on to the app", async ({ page }) => {
    await page.goto("/install");
    await expect(page.getByRole("heading", { name: "Install Photo to PGN" })).toBeVisible();
    const steps = page.locator(".install-steps li");
    await expect(steps).toHaveCount(3);
    await expect(steps.nth(0)).toContainText("Share button");
    await expect(steps.nth(1)).toContainText("Add to Home Screen");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.getByRole("button", { name: "Use it in the browser instead" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Install Photo to PGN" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Try the demo game instead" })).toBeVisible();
  });
});

test.describe("the install link on Android", () => {
  test.use(phone("Pixel 7"));

  test("one button opens the browser's install dialog", async ({ page }) => {
    await page.goto("/install");
    // Without the browser's offer yet: its menu.
    await expect(page.locator(".install-steps")).toContainText("Install app");
    // Chrome offers it (faked: headless Chrome never does).
    await page.evaluate(() => {
      const e = new Event("beforeinstallprompt") as Event & { prompt: () => Promise<void> };
      e.prompt = async () => {
        (window as unknown as { prompted: boolean }).prompted = true;
      };
      window.dispatchEvent(e);
    });
    await page.getByRole("button", { name: "Install Photo to PGN" }).click();
    expect(await page.evaluate(() => (window as unknown as { prompted?: boolean }).prompted)).toBe(true);
    await expect(page.getByText("Closed the dialog?")).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
    await expect(page.getByRole("status")).toContainText("Installed. Photo to PGN is on your home screen.");
    await expect(page.locator(".install-steps")).toHaveCount(0);
    await page.getByRole("button", { name: "Go to Photo to PGN" }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});

test("the install link on a computer says to open it on the phone", async ({ page }) => {
  await page.goto("/install");
  await expect(page.locator(".install")).toContainText(/Open this page on your phone: localhost:4173\/install/);
});
