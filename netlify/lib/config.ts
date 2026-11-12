// Settings for the server side, which serves only the queue for the owner's
// CLI reader (cli/pgn-worker.mjs). The server never holds an Anthropic key:
// readings with the owner's key go from the browser through the HintWise
// gateway, and readings with a visitor's key go from the browser straight to
// Anthropic. Every name starts with PGN_ so nothing is picked up by accident
// from a shell that has ANTHROPIC_* or CLAUDE_* set for other tools.

export interface Limits {
  perDay: number; // CLI readings per person per UTC day
  perWeek: number; // CLI readings per person per ISO week (UTC)
  globalPerDay: number; // all CLI readings per UTC day
}

export interface AppConfig {
  workerToken: string | null; // bearer token for the CLI reader endpoints; null turns the queue off
  limits: Limits;
  localTimeoutMs: number; // a queued job fails after this long
  leaseMs: number; // how long a claimed job is reserved for one CLI reader
  readerIdleMs: number; // no CLI check-in for this long: the reader counts as not running
  maxImages: number;
  maxImageBytes: number; // per image, after decoding
  supabaseUrl: string;
  supabaseAnonKey: string;
}

// The shared HintWise Supabase project. Public by design: the anon key only
// reaches what row level security allows (platform/supabase.json).
export const HINTWISE_SUPABASE_URL = "https://auth.hintwise.org";
export const HINTWISE_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFya3R4bHJseWNlZmZ5b3pkd2hxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4ODEwMTAsImV4cCI6MjA5MjQ1NzAxMH0.Vuku-irT3kAHZYibK23q6dpyOEqV_Eg5zB78I3dyshE";

function int(v: string | undefined, fallback: number): number {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  return {
    workerToken: env.PGN_WORKER_TOKEN?.trim() || null,
    limits: {
      perDay: int(env.PGN_READER_PER_DAY, 3),
      perWeek: int(env.PGN_READER_PER_WEEK, 10),
      globalPerDay: int(env.PGN_READER_GLOBAL_PER_DAY, 100),
    },
    localTimeoutMs: int(env.PGN_LOCAL_TIMEOUT_MINUTES, 30) * 60_000,
    leaseMs: int(env.PGN_LEASE_MINUTES, 15) * 60_000,
    readerIdleMs: int(env.PGN_READER_IDLE_SECONDS, 60) * 1000,
    maxImages: int(env.PGN_MAX_IMAGES, 2),
    maxImageBytes: int(env.PGN_MAX_IMAGE_BYTES, 2_000_000),
    supabaseUrl: env.PGN_SUPABASE_URL?.trim() || HINTWISE_SUPABASE_URL,
    supabaseAnonKey: env.PGN_SUPABASE_ANON_KEY?.trim() || HINTWISE_SUPABASE_ANON_KEY,
  };
}
