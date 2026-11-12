// Settings read from Netlify environment variables. See README "Settings".
// Every name starts with PGN_ so nothing is picked up by accident from a
// shell that has ANTHROPIC_* or CLAUDE_* set for other tools.

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface Limits {
  perDay: number; // free conversions per person per UTC day
  perWeek: number; // free conversions per person per ISO week (UTC)
  globalPerDay: number; // all free conversions per UTC day, a spending backstop
}

/**
 * Who reads free conversions:
 * - api: the owner's Anthropic key, right away (needs PGN_OWNER_API_KEY).
 * - local: queued for the owner's CLI reader (cli/pgn-worker.mjs), which uses
 *   a local Claude Code with a subscription.
 * - local-then-api: queued for the CLI; if no reader claims it within
 *   PGN_LOCAL_FALLBACK_SECONDS, the owner's key reads it.
 * Own-key conversions always use the visitor's key right away.
 */
export type FreeReader = "api" | "local" | "local-then-api";

export interface AppConfig {
  ownerKey: string | null;
  freeReader: FreeReader;
  workerToken: string | null; // bearer token for the CLI reader endpoints
  localFallbackMs: number;
  localTimeoutMs: number; // a queued local job fails after this long
  leaseMs: number; // how long a claimed job is reserved for one CLI reader
  model: string;
  effort: Effort;
  limits: Limits;
  maxImages: number;
  maxImageBytes: number; // per image, after decoding
  identitySalt: string;
  anthropicBaseURL: string;
}

function int(v: string | undefined, fallback: number): number {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];
const READERS: FreeReader[] = ["api", "local", "local-then-api"];

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const effort = (env.PGN_CLAUDE_EFFORT ?? "high") as Effort;
  const reader = (env.PGN_FREE_READER ?? "api") as FreeReader;
  return {
    ownerKey: env.PGN_OWNER_API_KEY?.trim() || null,
    freeReader: READERS.includes(reader) ? reader : "api",
    workerToken: env.PGN_WORKER_TOKEN?.trim() || null,
    localFallbackMs: int(env.PGN_LOCAL_FALLBACK_SECONDS, 120) * 1000,
    localTimeoutMs: int(env.PGN_LOCAL_TIMEOUT_MINUTES, 30) * 60_000,
    leaseMs: int(env.PGN_LEASE_MINUTES, 15) * 60_000,
    model: env.PGN_CLAUDE_MODEL?.trim() || "claude-opus-5-5",
    effort: EFFORTS.includes(effort) ? effort : "high",
    limits: {
      perDay: int(env.PGN_FREE_PER_DAY, 3),
      perWeek: int(env.PGN_FREE_PER_WEEK, 10),
      globalPerDay: int(env.PGN_FREE_GLOBAL_PER_DAY, 100),
    },
    maxImages: int(env.PGN_MAX_IMAGES, 2),
    maxImageBytes: int(env.PGN_MAX_IMAGE_BYTES, 2_000_000),
    identitySalt: env.PGN_IDENTITY_SALT ?? "photo2pgn",
    // Only for local tests against dev/mock-anthropic.mjs.
    anthropicBaseURL: env.PGN_ANTHROPIC_BASE_URL?.trim() || "https://api.anthropic.com",
  };
}
