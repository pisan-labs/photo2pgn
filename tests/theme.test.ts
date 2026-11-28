// @vitest-environment jsdom
// The light and dark mode switch (claude-built-apps platform/src/theme/README.md): its files, copied
// unchanged, the switch in the app's header and on the three legal pages, the colours in both modes,
// and print.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const sha = (s: string | Uint8Array, enc: "hex" | "base64"): string => createHash("sha256").update(s).digest(enc);

// From claude-built-apps platform/src/theme/README.md, "The values" (main at 1975ac1). This repository
// cannot see the source, so the values are pasted: a newer copy there means updating the files and these.
const HW_THEME_SHA256 = "8e78682bb6c0f0a30c20687122363ec3a5bf020df14faaa5235a99d065d71d9c";
const THEME_INIT_CSP = "'sha256-GhyjaPQKUCt6Zif2GMbTG7M6cUY6iW77/obk7CBvquk='";

const PAGES = ["index.html", "public/privacy.html", "public/terms.html", "public/refunds.html"];
const LEGAL = PAGES.slice(1);
const read = (p: string): string => readFileSync(p, "utf8");
const css = read("src/styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
const PRINT = /@media\s+print\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g;
const SCREEN_ATTR = /@media\s+screen\s*\{\s*:root\[data-theme="dark"\]\s*\{([^}]*)\}\s*\}/;
const SCREEN_DEVICE = /@media\s+screen\s+and\s+\(prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}\s*\}/;
const rules = (sheet: string, selector: string): string =>
  [...sheet.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].filter(([, s]) => s.split(",").some((x) => x.trim() === selector)).map((m) => m[2]).join(";");
const styleOf = (page: string): string => (read(page).match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "").replace(/\/\*[\s\S]*?\*\//g, "");

describe("the copies of the shared switch", () => {
  it("hw-theme.js is the platform copy, unchanged, bundled for the app and served for the legal pages", () => {
    expect(sha(readFileSync("src/lib/hw-theme.js"), "hex")).toBe(HW_THEME_SHA256);
    expect(sha(readFileSync("public/hw-theme.js"), "hex")).toBe(HW_THEME_SHA256);
  });

  it.each(PAGES)("%s runs the head snippet, unchanged, first in the head before any style or other script", (page) => {
    const html = read(page);
    const head = html.slice(0, html.indexOf("</head>"));
    const m = head.match(/<script>([^<]*hw-theme[^<]*)<\/script>/);
    expect(m).not.toBeNull();
    expect(`'sha256-${sha(m![1], "base64")}'`).toBe(THEME_INIT_CSP);
    const at = head.indexOf(m![0]);
    for (const later of ['<link rel="stylesheet"', "<style", "<script defer", '<script type="module"']) {
      const i = head.indexOf(later);
      expect(i === -1 || at < i, later).toBe(true);
    }
  });

  it("main.tsx loads hw-theme.js first, before the app and its stylesheet", () => {
    const main = read("src/main.tsx");
    const at = main.indexOf('import "./lib/hw-theme.js";');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(main.indexOf('import App from "./App";'));
    expect(at).toBeLessThan(main.indexOf('import "./styles.css";'));
  });

  it.each(LEGAL)("%s loads the served copy, deferred", (page) => {
    expect(read(page).match(/<script defer src="\/hw-theme\.js"><\/script>/g)).toHaveLength(1);
  });
});

const rgb = (hex: string): number[] => {
  const h = hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex;
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const lum = (c: number[]): number => {
  const [r, g, b] = c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: number[], b: number[]): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const mix = (a: number[], b: number[], share: number): number[] => a.map((v, i) => share * v + (1 - share) * b[i]);
const tokens = (body: string): Record<string, string> =>
  Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{3,6})\b/gi)].map((m) => [m[1], m[2].toLowerCase()]));
const outlineShare = Number(read("src/lib/hw-theme.js").match(/currentColor (\d+)%/)![1]) / 100;

describe.each([["the app (src/styles.css)", css], ...LEGAL.map((p) => [p, styleOf(p)])])("the palette of %s", (_name, sheet) => {
  const block = (re: RegExp): string => (sheet.match(re)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const light = tokens(sheet.match(/:root\s*\{([^}]*)\}/)![1]);
  const dark = { ...light, ...tokens(block(SCREEN_ATTR)) };

  it("has the dark set twice and the same, for screens only, and nothing else follows the device", () => {
    expect(block(SCREEN_ATTR)).not.toBe("");
    expect(block(SCREEN_DEVICE)).toBe(block(SCREEN_ATTR));
    expect(block(SCREEN_ATTR)).toContain("color-scheme: dark;");
    expect(sheet.match(/:root\s*\{([^}]*)\}/)![1]).toMatch(/color-scheme:\s*light;/);
    expect(sheet.replace(new RegExp(SCREEN_ATTR.source, "g"), "").replace(new RegExp(SCREEN_DEVICE.source, "g"), "")).not.toMatch(/data-theme|prefers-color-scheme/);
  });

  it("keeps its text at 4.5:1, and the switch's outline at 3:1, in both modes", () => {
    for (const t of [light, dark]) {
      for (const [fg, bg] of [["--text", "--bg"], ["--text", "--panel"], ["--muted", "--bg"], ["--muted", "--panel"], ["--accent", "--bg"], ["--accent", "--panel"]]) {
        expect(ratio(rgb(t[fg]), rgb(t[bg])), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
      // The header sits on the page's background.
      expect(ratio(mix(rgb(t["--text"]), rgb(t["--bg"]), outlineShare), rgb(t["--bg"]))).toBeGreaterThanOrEqual(3);
    }
    if (light["--brand"]) for (const t of [light, dark]) expect(ratio(rgb(t["--brand-ink"]), rgb(t["--brand"]))).toBeGreaterThanOrEqual(4.5);
  });

  it("reserves the switch's place and leaves it off paper", () => {
    expect(rules(sheet, "hw-theme-toggle:not([hidden])")).toMatch(/flex:\s*none/);
    expect(rules(sheet, "hw-theme-toggle:not([hidden])")).toMatch(/width:\s*var\(--hw-theme-toggle-size, 44px\)/);
    const print = [...sheet.matchAll(PRINT)];
    expect(print).toHaveLength(1);
    expect(print[0][1]).toMatch(/(?:^|[\s,}])hw-theme-toggle\s*\{\s*display:\s*none\s*!important;?\s*\}/);
    expect(sheet.slice(print[0].index! + print[0][0].length).trim()).toBe("");
  });
});

describe("print in the app", () => {
  it("gives a filled button's label the ink, since paper drops the fill", () => {
    expect(rules(css, "button")).toMatch(/background:\s*var\(--brand\)/);
    const print = [...css.matchAll(PRINT)][0][1];
    expect(rules(print, "button:not(.secondary):not(.link)")).toMatch(/color:\s*var\(--text\)/);
  });
});

describe("the switch", () => {
  beforeAll(async () => {
    await import("../src/lib/hw-theme.js");
  });
  beforeEach(() => {
    window.hintwise!.theme!.set(null);
    localStorage.clear();
  });

  it("is last in the app's header, after the account, in a group of its own", () => {
    const app = read("src/App.tsx");
    const header = app.slice(app.indexOf('<header className="top">'), app.indexOf("</header>"));
    const end = header.slice(header.indexOf('<div className="top-end">'));
    expect(end).toMatch(/\{user && \([\s\S]*<\/span>\s*\)\}[\s\S]*<hw-theme-toggle \/>\s*<\/div>\s*$/);
    expect(header.match(/<hw-theme-toggle/g)).toHaveLength(1);
    expect(rules(css, ".top-end")).toMatch(/display:\s*flex/);
    expect(rules(css, ".top-end")).not.toMatch(/flex-wrap:\s*wrap/);
  });

  it.each(LEGAL)("is at the end of %s's header, beside the way back to the app", (page) => {
    document.body.innerHTML = read(page).match(/<body>([\s\S]*)<\/body>/)![1];
    const toggle = document.querySelector("header.page-head hw-theme-toggle")!;
    expect(document.querySelectorAll("hw-theme-toggle")).toHaveLength(1);
    expect(toggle.parentElement!.lastElementChild).toBe(toggle);
    expect(toggle.previousElementSibling?.matches('a.back[href="/"]')).toBe(true);
    expect(rules(styleOf(page), ".page-head")).toMatch(/justify-content:\s*space-between/);
  });

  it("says what it will do, switches the page at once and remembers the choice", () => {
    document.body.innerHTML = "<header><hw-theme-toggle></hw-theme-toggle></header>";
    const button = document.querySelector("hw-theme-toggle")!.shadowRoot!.querySelector("button")!;
    expect(button.getAttribute("aria-label")).toBe("Switch to dark mode");
    button.click();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("hw-theme")).toBe("dark");
    expect(button.getAttribute("aria-label")).toBe("Switch to light mode");
  });
});
