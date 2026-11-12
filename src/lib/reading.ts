// How one set of photos gets read, from the visitor's choice:
//
//   own key  -> straight from this browser to Anthropic (BYOK)
//   free     -> needs a HintWise account; then, by the build's VITE_FREE_READER:
//               "gateway" (default): the owner's key through the HintWise
//                   gateway and its caps;
//               "local": queued for the owner's CLI reader;
//               "local-then-gateway": queued only while a reader is running
//                   (else straight to the gateway), and if no reader has
//                   claimed it within VITE_LOCAL_FALLBACK_SECONDS, cancelled
//                   and read through the gateway instead.
import Anthropic from "@anthropic-ai/sdk";
import { CapReached, GatewayError, LlmUnavailable, memoryStorage, setByokKey, type AskDeps } from "./llm";
import { ReadFailed, readScoresheet, type PhotoInput } from "./read";
import { ApiError, cancelJob, queueForReader, waitForJob, type QueuedJob, type WaitOptions } from "./api";
import type { Extraction } from "./schema";

export type FreeReader = "gateway" | "local" | "local-then-gateway";
export type Phase = "reading" | "queued" | "local";

export function freeReaderFrom(env: Record<string, unknown> = import.meta.env): FreeReader {
  const v = env.VITE_FREE_READER;
  return v === "local" || v === "local-then-gateway" ? v : "gateway";
}

export function fallbackMsFrom(env: Record<string, unknown> = import.meta.env): number {
  const n = Number(env.VITE_LOCAL_FALLBACK_SECONDS);
  return (Number.isFinite(n) && n > 0 ? n : 120) * 1000;
}

export interface ReadPlan {
  mode: "free" | "own-key";
  apiKey?: string;
  reader?: FreeReader;
  fallbackMs?: number;
  signal?: AbortSignal;
  onPhase?: (phase: Phase) => void;
  /** Called once a job is queued, so the page can resume it after a reload. */
  onQueued?: (job: QueuedJob) => void;
  getToken?: () => Promise<string | null>;
  // Seams for tests.
  ask?: AskDeps;
  queue?: typeof queueForReader;
  wait?: (job: QueuedJob, opts: WaitOptions) => Promise<Extraction>;
  cancel?: typeof cancelJob;
  now?: () => number;
}

export async function readPhotos(photos: PhotoInput[], plan: ReadPlan): Promise<Extraction> {
  const phase = plan.onPhase ?? (() => undefined);
  if (plan.mode === "own-key") {
    // The key goes only from this browser to api.anthropic.com.
    const storage = memoryStorage();
    setByokKey(plan.apiKey ?? null, storage);
    phase("reading");
    return (await readScoresheet(photos, { ...plan.ask, mode: "byok", storage })).extraction;
  }

  const getToken = plan.getToken ?? plan.ask?.getToken;
  const viaGateway = async () => {
    phase("reading");
    return (await readScoresheet(photos, { ...plan.ask, mode: "gateway", getToken })).extraction;
  };
  const reader = plan.reader ?? freeReaderFrom();
  if (reader === "gateway") return viaGateway();

  const token = getToken ? await getToken() : null;
  if (!token) throw new LlmUnavailable("Sign in to use the free reading.");
  phase("queued");
  let job: QueuedJob;
  try {
    job = await (plan.queue ?? queueForReader)(photos, token, undefined, { onlyIfReaderRunning: reader === "local-then-gateway" });
  } catch (err) {
    // No reader is running, or the queue is off or out of reach: read through the gateway
    // straight away rather than leave the visitor with an error. Its own
    // allowance answers (limit_*) are passed on.
    const fallBack = reader === "local-then-gateway" && err instanceof ApiError && !err.code.startsWith("limit_");
    if (fallBack) return viaGateway();
    throw err;
  }
  plan.onQueued?.(job);
  return followQueued(job, { ...plan, reader, viaGateway });
}

/** Wait for a queued job; with local-then-gateway, give up on the queue in time. */
export async function followQueued(
  job: QueuedJob,
  plan: ReadPlan & { viaGateway?: () => Promise<Extraction> },
): Promise<Extraction> {
  const phase = plan.onPhase ?? (() => undefined);
  const now = plan.now ?? Date.now;
  const started = now();
  const fallbackMs = plan.fallbackMs ?? fallbackMsFrom();
  const canFallBack = plan.reader === "local-then-gateway" && Boolean(plan.viaGateway);
  const stop = new AbortController();
  plan.signal?.addEventListener("abort", () => stop.abort());
  let fellBack = false;
  try {
    return await (plan.wait ?? waitForJob)(job, {
      signal: stop.signal,
      onStatus: (s) => {
        if (s === "running") phase("local");
        else if (s === "queued" && canFallBack && now() - started > fallbackMs) {
          fellBack = true;
          stop.abort();
        }
      },
    });
  } catch (err) {
    if (!fellBack) throw err;
  }
  await (plan.cancel ?? cancelJob)(job);
  return plan.viaGateway!();
}

/** A cap of the owner's key, in plain words with the reset in local time. */
export function capMessage(err: CapReached, locale?: string): string {
  const at = new Date(err.resetsAt);
  const when = Number.isNaN(at.getTime())
    ? ""
    : ` until ${at.toLocaleString(locale, { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
  return `Out of credits${when}. Use your own Anthropic API key to keep going.`;
}

/** What went wrong, for the person; `ownKey` suggests switching to their own key. */
export function describeError(err: unknown): { message: string; ownKey: boolean } {
  if (err instanceof CapReached) return { message: capMessage(err), ownKey: true };
  if (err instanceof ReadFailed || err instanceof LlmUnavailable || err instanceof GatewayError) {
    return { message: err.message, ownKey: false };
  }
  if (err instanceof ApiError) return { message: err.message, ownKey: err.code.startsWith("limit_") };
  if (err instanceof Anthropic.APIError) {
    if (err.status === 401 || err.status === 403) return { message: "Anthropic rejected your API key.", ownKey: false };
    if (err.status === 429) return { message: "Anthropic is rate limiting your key. Try again in a minute.", ownKey: false };
    return { message: `Anthropic answered with an error (${err.status ?? "network"}). Try again.`, ownKey: false };
  }
  return { message: err instanceof Error ? err.message : String(err), ownKey: false };
}
