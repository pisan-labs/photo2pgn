// How long a grant from the admin panel's "Payments to grant" may still be
// landing, and how a time reads there: one place for photo2pgn's server
// (netlify/lib/admin-payments.ts) and the panel (src/lib/payments.ts), so the
// server's messages and the browser's give every time the same way, in the
// admin's own time zone, with the zone named (review r2, RPP.2-1).

/** A grant claim younger than this is a grant under way; after it, anything the grant did has landed. */
export const GRANT_CLAIM_MS = 2 * 60_000;

/** The header the panel sends its time zone in (an IANA name), so the server's messages give times in it too. */
export const TIME_ZONE_HEADER = "x-time-zone";

/** The zone, as Intl names it, when Intl knows it; otherwise UTC, which the server falls back to when the panel did not say. */
export function zoneOrUtc(zone: string | null | undefined): string {
  if (!zone || zone.length > 64) return "UTC";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

/** The device's own time zone, for the panel to send; null where Intl cannot say. */
export function deviceZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** "Sat, Nov 28, 10:02 AM PST": in the zone given (the device's own when none), the zone named; "" for a time it cannot read. */
export function clockTime(iso: string, zone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: zone, timeZoneName: "short" });
}

/** When a claim taken at `claim` stops being young, as an ISO time; null when the claim's time cannot be read. */
export function claimEnd(claim: string): string | null {
  const t = Date.parse(claim);
  return Number.isNaN(t) ? null : new Date(t + GRANT_CLAIM_MS).toISOString();
}
