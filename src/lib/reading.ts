// How one set of photos gets read, from the visitor's choice:
//
//   own key  -> straight from this browser to Anthropic (BYOK)
//   free     -> needs a HintWise account; then, by the build's VITE_FREE_READER:
//               "gateway" (default): the owner's key through the HintWise
//                   gateway and its caps, read while the page waits;
//               "local": queued for the owner's CLI reader (halflife); the
//                   page does not wait, the game arrives in My games
//                   (collect.ts);
//               "local-then-gateway": queued while a reader is running; when
//                   it cannot take the photos (not running, out of reach, its
//                   own ceiling reached) the gateway reads them at once, and
//                   its count of the person's credits decides.
import Anthropic from "@anthropic-ai/sdk";
import { CapReached, GatewayError, LlmUnavailable, memoryStorage, setByokKey, type AskDeps } from "./llm";
import { ReadFailed, readScoresheet, type PhotoInput } from "./read";
import { ApiError, queueForReader, type QueuedJob } from "./api";
import type { Extraction } from "./schema";

export type FreeReader = "gateway" | "local" | "local-then-gateway";
/** What the page shows while it waits: the photos going to the queue, or a reading in the page. */
export type Phase = "reading" | "sending";

/** Read now (own key, gateway), or queued for the HintWise reader: the game comes later. */
export type ReadOutcome = { kind: "read"; extraction: Extraction } | { kind: "queued"; job: QueuedJob };

export function freeReaderFrom(env: Record<string, unknown> = import.meta.env): FreeReader {
  const v = env.VITE_FREE_READER;
  return v === "local" || v === "local-then-gateway" ? v : "gateway";
}

export interface ReadPlan {
  mode: "free" | "own-key";
  apiKey?: string;
  reader?: FreeReader;
  onPhase?: (phase: Phase) => void;
  getToken?: () => Promise<string | null>;
  // Seams for tests.
  ask?: AskDeps;
  queue?: typeof queueForReader;
}

export async function readPhotos(photos: PhotoInput[], plan: ReadPlan): Promise<ReadOutcome> {
  const phase = plan.onPhase ?? (() => undefined);
  if (plan.mode === "own-key") {
    // The key goes only from this browser to api.anthropic.com.
    const storage = memoryStorage();
    setByokKey(plan.apiKey ?? null, storage);
    phase("reading");
    return { kind: "read", extraction: (await readScoresheet(photos, { ...plan.ask, mode: "byok", storage })).extraction };
  }

  const getToken = plan.getToken ?? plan.ask?.getToken;
  const viaGateway = async (): Promise<ReadOutcome> => {
    phase("reading");
    return { kind: "read", extraction: (await readScoresheet(photos, { ...plan.ask, mode: "gateway", getToken })).extraction };
  };
  const reader = plan.reader ?? freeReaderFrom();
  if (reader === "gateway") return viaGateway();

  const token = getToken ? await getToken() : null;
  if (!token) throw new LlmUnavailable("Sign in to use the free reading.");
  phase("sending");
  try {
    const job = await (plan.queue ?? queueForReader)(photos, token, undefined, { onlyIfReaderRunning: reader === "local-then-gateway" });
    return { kind: "queued", job };
  } catch (err) {
    // The reader cannot take them: the gateway reads them now, and answers
    // for the person's credits (a sheet costs one credit either way). Not
    // when the credits are spoken for by sheets already with the reader:
    // the gateway would spend them twice.
    if (reader === "local-then-gateway" && err instanceof ApiError && err.code !== "limit_credits") return viaGateway();
    throw err;
  }
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
