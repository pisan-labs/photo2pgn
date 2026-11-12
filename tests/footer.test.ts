// The HintWise footer must be embedded byte for byte, once, in the source
// index.html (a declarative shadow root only renders when parsed as HTML).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const html = readFileSync("index.html", "utf8");
const FOOTER_SHA = "59e0391031a6fb75245c13f761633a8cbecb51ab9ca6311d2c5948170cdea6b3";

function footerOf(page: string) {
  const open = "<site-footer data-site-footer>";
  const start = page.indexOf(open);
  return { count: page.split(open).length - 1, markup: page.slice(start, page.indexOf("</site-footer>", start) + "</site-footer>".length), start };
}

describe("HintWise footer", () => {
  it("appears once, unchanged, after #root", () => {
    const open = "<site-footer data-site-footer>";
    const close = "</site-footer>";
    expect(html.split(open)).toHaveLength(2);
    const start = html.indexOf(open);
    const markup = html.slice(start, html.indexOf(close, start) + close.length);
    expect(createHash("sha256").update(markup).digest("hex")).toBe(
      "59e0391031a6fb75245c13f761633a8cbecb51ab9ca6311d2c5948170cdea6b3",
    );
    expect(start).toBeGreaterThan(html.indexOf('<div id="root">'));
    expect(start).toBeLessThan(html.indexOf("</body>"));
  });
  it("uses the HintWise favicon", () => {
    expect(html).toMatch(/<link rel="icon" href="data:image\/svg\+xml,[^"]*%23312E81/);
  });
  it("is on the printable scoresheet too, unchanged", () => {
    const sheet = readFileSync("public/scoresheet.html", "utf8");
    const f = footerOf(sheet);
    expect(f.count).toBe(1);
    expect(createHash("sha256").update(f.markup).digest("hex")).toBe(FOOTER_SHA);
    expect(sheet.match(/<tr><th>\d+<\/th>/g)).toHaveLength(30);
  });
});
