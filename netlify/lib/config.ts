// Settings read from Netlify environment variables. See README "Settings".
// Every name starts with PGN_ so nothing is picked up by accident from a
// shell that has ANTHROPIC_* or CLAUDE_* set for other tools.

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface Limits {
  perDay: number; // free conversions per person per UTC day
  perWeek: number; // free conversions per person per ISO week (UTC)
  globalPerDay: number; // all free conversions per UTC day, a spending backstop
}

export interface AppConfig {
  ownerKey: string | null;
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

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const effort = (env.PGN_CLAUDE_EFFORT ?? "high") as Effort;
  return {
    ownerKey: env.PGN_OWNER_API_KEY?.trim() || null,
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
