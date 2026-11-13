// Which ways in to offer: sign in or the own key, and only the own key when out of credits.
import { describe, expect, it } from "vitest";
import { CapReached } from "../src/lib/llm";
import { ApiError } from "../src/lib/api";
import { accessOptions, displayName, isOwnKey, nextRenewal, outMessage, outOfCreditsFrom, readyToRead, renewalLine, stillOut } from "../src/lib/access";

describe("the ways in", () => {
  it("offers sign-in and the own key, or only the own key", () => {
    expect(accessOptions({ signInAvailable: true, out: false })).toEqual(["sign-in", "own-key"]);
    expect(accessOptions({ signInAvailable: true, out: true })).toEqual(["own-key"]);
    expect(accessOptions({ signInAvailable: false, out: false })).toEqual(["own-key"]);
  });

  it("is ready once signed in with credits left, or with a well-formed key", () => {
    const base = { signedIn: false, out: false, apiKey: "" };
    expect(readyToRead({ ...base, choice: "sign-in" })).toBe(false);
    expect(readyToRead({ ...base, choice: "sign-in", signedIn: true })).toBe(true);
    expect(readyToRead({ ...base, choice: "sign-in", signedIn: true, out: true })).toBe(false);
    expect(readyToRead({ ...base, choice: "own-key", apiKey: "sk-ant-short" })).toBe(false);
    expect(readyToRead({ ...base, choice: "own-key", apiKey: " sk-ant-api03-0123456789 " })).toBe(true);
    expect(isOwnKey("sk-something-else-0123456789")).toBe(false);
  });
});

describe("out of credits", () => {
  const now = new Date("2026-11-12T20:00:00Z"); // a Thursday

  it("is learned from the gateway's cap, until its reset", () => {
    const mark = outOfCreditsFrom(new CapReached("app-user-day", "2026-11-13T00:00:00Z"), "u1", now);
    expect(mark).toEqual({ userId: "u1", until: "2026-11-13T00:00:00.000Z" });
    // A cap with no usable reset time: the next UTC midnight.
    expect(outOfCreditsFrom(new CapReached("user-day", "soon"), "u1", now)!.until).toBe("2026-11-13T00:00:00.000Z");
  });

  it("is learned from the HintWise reader's counts: a day, or the ISO week", () => {
    expect(outOfCreditsFrom(new ApiError("limit_day", "Used up"), "u1", now)!.until).toBe("2026-11-13T00:00:00.000Z");
    expect(outOfCreditsFrom(new ApiError("limit_global", "Used up"), "u1", now)!.until).toBe("2026-11-13T00:00:00.000Z");
    expect(outOfCreditsFrom(new ApiError("limit_week", "Used up"), "u1", now)!.until).toBe("2026-11-16T00:00:00.000Z");
    const monday = new Date("2026-11-16T08:00:00Z");
    expect(outOfCreditsFrom(new ApiError("limit_week", "Used up"), "u1", monday)!.until).toBe("2026-11-23T00:00:00.000Z");
  });

  it("is not learned from other failures", () => {
    expect(outOfCreditsFrom(new ApiError("network", "Offline"), "u1", now)).toBeNull();
    expect(outOfCreditsFrom(new Error("boom"), "u1", now)).toBeNull();
  });

  it("holds for that person only, until the reset", () => {
    const mark = { userId: "u1", until: "2026-11-13T00:00:00.000Z" };
    expect(stillOut(mark, "u1", now.getTime())).toBe(mark);
    expect(stillOut(mark, "u2", now.getTime())).toBeNull();
    expect(stillOut(mark, null, now.getTime())).toBeNull();
    expect(stillOut(mark, "u1", Date.parse("2026-11-13T00:00:01Z"))).toBeNull();
    expect(stillOut(null, "u1")).toBeNull();
  });

  it("says when the credits come back and offers the own key", () => {
    expect(outMessage({ userId: "u1", until: "2026-11-13T17:00:00Z" }, "en-US")).toMatch(/^Out of credits until .+\. Use your own Anthropic API key to keep going\.$/);
  });
});

describe("new credits", () => {
  it("come with the gateway's UTC day, shown in the person's time", () => {
    expect(nextRenewal(new Date("2026-11-13T07:00:00Z")).toISOString()).toBe("2026-11-14T00:00:00.000Z");
    expect(nextRenewal(new Date("2026-11-13T23:59:59Z")).toISOString()).toBe("2026-11-14T00:00:00.000Z");
    expect(renewalLine(new Date("2026-11-13T07:00:00Z"), "en-US")).toMatch(/^New credits every day at \d{1,2}:00\s?[AP]M\.$/);
  });
});

describe("who is signed in", () => {
  it("shows the name from the sign-in provider, else the email", () => {
    expect(displayName({ email: "y@uw.edu", user_metadata: { full_name: " Yusuf Pisan " } })).toBe("Yusuf Pisan");
    expect(displayName({ email: "y@uw.edu", user_metadata: { name: "Yusuf" } })).toBe("Yusuf");
    expect(displayName({ email: "y@uw.edu", user_metadata: { full_name: "  " } })).toBe("y@uw.edu");
    expect(displayName({ email: "y@uw.edu" })).toBe("y@uw.edu");
    expect(displayName({})).toBe("Your account");
  });
});
