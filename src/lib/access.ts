// How a reading is paid for, and which ways in to offer.
//
//   sign-in   the HintWise gateway, within the person's credits (the owner's key)
//   own-key   the visitor's own Anthropic API key, straight from this browser
//
// The gateway has no "credits left" call: it answers 429 once a cap is
// reached. That answer is remembered per person until its reset time, and
// meanwhile only the own key is offered. Buying credits would be one more
// option here, offered to a person who is out.
import { CapReached } from "./llm";
import { ApiError } from "./api";

export type AccessOption = "sign-in" | "own-key";

export const OUT_OF_CREDITS_STORAGE = "photo2pgn.outOfCredits";

export interface OutOfCredits {
  userId: string;
  until: string; // ISO time the credits come back
}

/** The ways in to offer, in order. */
export function accessOptions(opts: { signInAvailable: boolean; out: boolean }): AccessOption[] {
  if (!opts.signInAvailable || opts.out) return ["own-key"];
  return ["sign-in", "own-key"];
}

export function isOwnKey(key: string): boolean {
  return /^sk-ant-\S{10,}$/.test(key.trim());
}

/** A reading can start: signed in with credits left, or with a well-formed own key. */
export function readyToRead(opts: { choice: AccessOption; signedIn: boolean; out: boolean; apiKey: string }): boolean {
  return opts.choice === "sign-in" ? opts.signedIn && !opts.out : isOwnKey(opts.apiKey);
}

function nextUtcMidnight(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

function nextUtcMonday(now: Date): Date {
  const daysToMonday = ((8 - now.getUTCDay()) % 7) || 7;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysToMonday));
}

/** When a refusal says the person is out of credits, until when; otherwise null. */
export function outOfCreditsFrom(err: unknown, userId: string, now = new Date()): OutOfCredits | null {
  if (err instanceof CapReached) {
    const at = new Date(err.resetsAt);
    return { userId, until: (Number.isNaN(at.getTime()) ? nextUtcMidnight(now) : at).toISOString() };
  }
  // The HintWise reader's own counts: per UTC day and ISO week.
  // (Not limit_credits: the gateway's own check says when credits come back.)
  if (err instanceof ApiError && err.code.startsWith("limit_") && err.code !== "limit_credits") {
    return { userId, until: (err.code === "limit_week" ? nextUtcMonday(now) : nextUtcMidnight(now)).toISOString() };
  }
  return null;
}

/** The stored mark, if it is this person's and has not run out. */
export function stillOut(mark: OutOfCredits | null | undefined, userId: string | null, now = Date.now()): OutOfCredits | null {
  if (!mark || !userId || mark.userId !== userId) return null;
  return new Date(mark.until).getTime() > now ? mark : null;
}

/** "Out of credits until Fri 9:00 AM", in the person's own time. */
export function outMessage(mark: OutOfCredits, locale?: string): string {
  const at = new Date(mark.until);
  const when = at.toLocaleString(locale, { weekday: "short", hour: "numeric", minute: "2-digit" });
  return `Out of credits until ${when}. Use your own Anthropic API key to keep going.`;
}

/** The free credits renew with the gateway's UTC day: the next 00:00 UTC. */
export function nextRenewal(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

/** "New credits every day at 4:00 PM", in the person's own time. */
export function renewalLine(now = new Date(), locale?: string): string {
  const at = nextRenewal(now).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  return `New credits every day at ${at}.`;
}

/** The person's name from their sign-in provider, else their email address. */
export function displayName(user: { email?: string | null; user_metadata?: Record<string, unknown> }): string {
  const m = user.user_metadata ?? {};
  const name = [m.full_name, m.name].find((v): v is string => typeof v === "string" && v.trim() !== "");
  return name?.trim() ?? user.email ?? "Your account";
}
