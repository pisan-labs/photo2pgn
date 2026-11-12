// Caps on free conversions (the owner's API key): per person per day, per
// person per week, and a global daily backstop. Counters live in the KV store
// and are updated with compare-and-swap so two tabs cannot both take the last
// conversion. Conversions with the visitor's own key are not counted.
import type { KV } from "./kv";
import type { Limits } from "./config";

export interface Counter {
  used: number;
  limit: number;
}

export interface QuotaStatus {
  day: Counter;
  week: Counter;
  global: Counter;
  remaining: number;
  dayResetsAt: string;
  weekResetsAt: string;
}

export type QuotaDenial = "day" | "week" | "global";

/** UTC calendar day, e.g. 2026-11-12. */
export function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** ISO 8601 week in UTC, e.g. 2026-W46. */
export function weekKey(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day); // Thursday decides the year
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function nextDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

function nextMonday(now: Date): Date {
  const day = now.getUTCDay() || 7;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 8 - day));
}

function keys(identity: string, now: Date) {
  return {
    day: `day/${dayKey(now)}/${identity}`,
    week: `week/${weekKey(now)}/${identity}`,
    global: `global/${dayKey(now)}`,
  };
}

async function read(kv: KV, key: string): Promise<number> {
  return (await kv.getJSON<{ n: number }>(key))?.value.n ?? 0;
}

/** Add delta to a counter unless that would pass max. Retries lost races. */
async function bump(kv: KV, key: string, delta: number, max = Infinity): Promise<boolean> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const cur = await kv.getJSON<{ n: number }>(key);
    const n = cur?.value.n ?? 0;
    if (delta > 0 && n + delta > max) return false;
    const value = { n: Math.max(0, n + delta) };
    const ok = cur ? await kv.setJSON(key, value, { onlyIfMatch: cur.etag }) : await kv.setJSON(key, value, { onlyIfNew: true });
    if (ok) return true;
  }
  throw new Error(`quota counter ${key} is busy`);
}

export async function getQuota(kv: KV, identity: string, limits: Limits, now = new Date()): Promise<QuotaStatus> {
  const k = keys(identity, now);
  const [day, week, global] = await Promise.all([read(kv, k.day), read(kv, k.week), read(kv, k.global)]);
  return {
    day: { used: day, limit: limits.perDay },
    week: { used: week, limit: limits.perWeek },
    global: { used: global, limit: limits.globalPerDay },
    remaining: Math.max(0, Math.min(limits.perDay - day, limits.perWeek - week, limits.globalPerDay - global)),
    dayResetsAt: nextDay(now).toISOString(),
    weekResetsAt: nextMonday(now).toISOString(),
  };
}

/** Take one free conversion. On denial nothing is counted. */
export async function reserve(
  kv: KV,
  identity: string,
  limits: Limits,
  now = new Date(),
): Promise<{ ok: true } | { ok: false; denied: QuotaDenial }> {
  const k = keys(identity, now);
  if (!(await bump(kv, k.day, 1, limits.perDay))) return { ok: false, denied: "day" };
  if (!(await bump(kv, k.week, 1, limits.perWeek))) {
    await bump(kv, k.day, -1);
    return { ok: false, denied: "week" };
  }
  if (!(await bump(kv, k.global, 1, limits.globalPerDay))) {
    await bump(kv, k.day, -1);
    await bump(kv, k.week, -1);
    return { ok: false, denied: "global" };
  }
  return { ok: true };
}

/** Give back a conversion taken at `reservedAt` (the job failed on our side). */
export async function release(kv: KV, identity: string, reservedAt: Date): Promise<void> {
  const k = keys(identity, reservedAt);
  await bump(kv, k.day, -1);
  await bump(kv, k.week, -1);
  await bump(kv, k.global, -1);
}
