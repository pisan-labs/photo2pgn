// HintWise first-party analytics (owner, 17 Nov: "add analytics to the rest of
// the apps"): the platform's script copied byte for byte, its tag once in the
// head of every page, app events with short scalar props only, and a privacy
// page that says what is counted.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { track } from "../src/lib/analytics";

const SCRIPT_SHA = "d2833162b9f18f9f2fdb36dbd62440c13ee26c6600200d8e55ad32b907f00633";
const TAG = '<script defer src="/hw-events.js" data-app="photo2pgn"></script>';
const PAGES = ["index.html", "public/terms.html", "public/refunds.html", "public/privacy.html"];

describe("analytics script", () => {
  it("is the platform's hw-events.js, unchanged, served at /hw-events.js", () => {
    const js = readFileSync("public/hw-events.js");
    expect(createHash("sha256").update(js).digest("hex")).toBe(SCRIPT_SHA);
  });

  for (const page of PAGES) {
    it(`${page}: the tag once, in the head`, () => {
      const html = readFileSync(page, "utf8");
      expect(html.split(TAG)).toHaveLength(2);
      expect(html.split("hw-events.js")).toHaveLength(2);
      expect(html.indexOf(TAG)).toBeLessThan(html.indexOf("</head>"));
    });
  }

  it("loads from the site root on every route: no relative base in the build", () => {
    expect(readFileSync("vite.config.ts", "utf8")).not.toMatch(/\bbase\s*:/);
  });

  it("the service worker leaves it and the beacons alone", () => {
    const sw = readFileSync("public/sw.js", "utf8");
    expect(sw).toContain("if (url.origin !== self.location.origin) return;");
    expect(sw).not.toContain("hw-events");
  });
});

describe("track", () => {
  it("passes the event to the script when it is loaded", () => {
    const send = vi.fn();
    track("pgn_exported", { how: "download", demo: false }, { hintwise: { track: send } });
    expect(send).toHaveBeenCalledWith("pgn_exported", { how: "download", demo: false });
  });

  it("does nothing without the script, and never throws", () => {
    expect(() => track("demo_opened", {}, {})).not.toThrow();
    expect(() => track("demo_opened", {}, { hintwise: {} })).not.toThrow();
    const broken = () => {
      throw new Error("blocked");
    };
    expect(() => track("read_started", { sheets: 2, key: "credits" }, { hintwise: { track: broken } })).not.toThrow();
    expect(() => track("demo_opened", {})).not.toThrow();
  });

  it("app events carry kinds and counts only, never what was read or typed", () => {
    const app = readFileSync("src/App.tsx", "utf8") + readFileSync("src/components/ReviewPanel.tsx", "utf8");
    const calls = [...app.matchAll(/track\("([a-z_]+)", (\{[^}]*\})/g)].map((m) => [m[1], m[2]]);
    expect(calls.map(([n]) => n).sort()).toEqual(["demo_opened", "pgn_exported", "read_started"]);
    for (const [, props] of calls) expect(props).not.toMatch(/pgn|headers|extraction|white|black|event|email|apiKey|user/i);
  });
});

describe("privacy page", () => {
  it("says what is counted, and that nothing is sent under Global Privacy Control", () => {
    const t = readFileSync("public/privacy.html", "utf8").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(t).not.toContain("no advertising or analytics trackers");
    expect(t).toContain("HintWise counts visits for its own analytics, with no cookie and nothing kept in your browser");
    expect(t).toContain("It never includes your photos, scoresheets, games, moves, names or anything you type");
    expect(t).toContain("Nothing is sent if your browser has Global Privacy Control or Do Not Track turned on");
    // The server's side (claude-built-apps platform/src/analytics): a device class from the user agent,
    // and a daily salt that app_events_record deletes when it records a later day's first event.
    expect(t).toContain("Our server also keeps the kind of device (phone, tablet or computer), worked out from your browser's user agent");
    expect(t).toContain("deleted once the next day's first visit is counted");
  });
});
