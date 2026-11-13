// The terms, refund and privacy pages (drafts in legal/ until the owner approves
// them; then they move to public/): the HintWise footer byte for byte, the
// seller and its reseller named, and the numbers taken from src/lib/credits.ts.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { CREDIT_PACKS, FREE_PER_DAY, FREE_PER_WEEK, REFUND_DAYS, packLabel } from "../src/lib/credits";

const FOOTER_SHA = "59e0391031a6fb75245c13f761633a8cbecb51ab9ca6311d2c5948170cdea6b3";
const PAGES = ["terms", "refunds", "privacy"] as const;
const read = (slug: string) => readFileSync(`legal/${slug}.html`, "utf8");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ");

describe("legal pages", () => {
  for (const slug of PAGES) {
    it(`${slug}: the HintWise footer once, unchanged, and links to the other pages`, () => {
      const html = read(slug);
      const open = "<site-footer data-site-footer>";
      expect(html.split(open)).toHaveLength(2);
      const start = html.indexOf(open);
      const markup = html.slice(start, html.indexOf("</site-footer>", start) + "</site-footer>".length);
      expect(createHash("sha256").update(markup).digest("hex")).toBe(FOOTER_SHA);
      expect(html).toMatch(/<link rel="icon" href="data:image\/svg\+xml,[^"]*%23312E81/);
      expect(text(html)).toContain("HintWise");
      for (const other of PAGES.filter((p) => p !== slug)) expect(html).toContain(`href="/${other}.html"`);
    });
  }

  it("terms: the seller, Paddle as Merchant of Record, the prices and the free amounts", () => {
    const t = text(read("terms"));
    expect(t).toContain("provided by HintWise");
    expect(t).toContain("laws of the State of California, USA"); // owner, 13 Nov
    expect(t).toContain("Our order process is conducted by our online reseller Paddle.com. Paddle.com is the Merchant of Record for all our orders.");
    for (const p of CREDIT_PACKS) {
      expect(t).toContain(`${p.credits} credits`);
      expect(t).toContain(`US$${p.priceUsd}`);
      expect(packLabel(p)).toBe(`${p.credits} credits for US$${p.priceUsd}`);
    }
    expect(t).toContain(`${FREE_PER_DAY} free readings a day and ${FREE_PER_WEEK} a week`);
  });

  it("refunds: the window from credits.ts", () => {
    const t = text(read("refunds"));
    expect(t).toContain(`Within ${REFUND_DAYS} days`);
    expect(t).toContain(`After ${REFUND_DAYS} days`);
  });

  it("privacy: every party that handles data, and how to reach us", () => {
    const t = text(read("privacy"));
    for (const who of ["Anthropic", "Supabase", "Netlify", "Paddle", "Lichess", "Chess TD"]) expect(t).toContain(who);
    expect(t).toContain("builder@hintwise.org");
    expect(t).toContain("for up to a day"); // the HintWise reader exception, as the README discloses
  });
});
