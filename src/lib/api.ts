// Browser side of the queue for the HintWise reader (the owner's CLI).
import type { Extraction } from "./schema";
import type { PhotoInput } from "./read";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface QueuedJob {
  jobId: string;
  viewToken: string;
}

async function parse(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new ApiError("bad_response", `The server answered with HTTP ${res.status}.`);
  }
}

function errorOf(body: Record<string, unknown>, status: number): ApiError {
  const e = (body.error ?? {}) as { code?: string; message?: string };
  return new ApiError(e.code ?? "error", e.message ?? `HTTP ${status}`);
}

export interface QueueOptions {
  /** Refuse at once (reader_idle) unless a reader is running: the caller has another way to read. */
  onlyIfReaderRunning?: boolean;
}

/** Queue photos for the HintWise reader; needs the visitor's session token. */
export async function queueForReader(
  photos: PhotoInput[],
  token: string,
  doFetch: typeof fetch = fetch,
  opts: QueueOptions = {},
): Promise<QueuedJob> {
  let res: Response;
  try {
    res = await doFetch("/api/convert", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ images: photos, ...(opts.onlyIfReaderRunning ? { onlyIfReaderRunning: true } : {}) }),
    });
  } catch {
    throw new ApiError("network", "Could not reach the server. Check your connection and try again.");
  }
  const body = await parse(res);
  if (!res.ok) throw errorOf(body, res.status);
  return body as unknown as QueuedJob;
}

export async function cancelJob(job: QueuedJob, doFetch: typeof fetch = fetch): Promise<void> {
  const url = `/api/jobs/${encodeURIComponent(job.jobId)}?token=${encodeURIComponent(job.viewToken)}`;
  await doFetch(url, { method: "DELETE" }).catch(() => undefined);
}

export interface WaitOptions {
  signal?: AbortSignal;
  intervalMs?: number;
  timeoutMs?: number;
  onStatus?: (status: string) => void;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Poll a queued job until it is done. */
export async function waitForJob(job: QueuedJob, opts: WaitOptions = {}): Promise<Extraction> {
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const interval = opts.intervalMs ?? 2500;
  // The server gives up on a job after 30 minutes in the queue.
  const deadline = now() + (opts.timeoutMs ?? 32 * 60 * 1000);
  const url = `/api/jobs/${encodeURIComponent(job.jobId)}?token=${encodeURIComponent(job.viewToken)}`;
  let failures = 0;
  while (now() < deadline) {
    if (opts.signal?.aborted) throw new ApiError("cancelled", "Cancelled.");
    await sleep(interval);
    if (opts.signal?.aborted) throw new ApiError("cancelled", "Cancelled.");
    let body: Record<string, unknown>;
    try {
      const res = await doFetch(url, { signal: opts.signal });
      body = await parse(res);
      if (!res.ok) throw errorOf(body, res.status);
      failures = 0;
    } catch (err) {
      if (opts.signal?.aborted) throw new ApiError("cancelled", "Cancelled.");
      if (err instanceof ApiError && err.code === "not_found") throw err;
      if (++failures >= 5) throw new ApiError("network", "Lost contact with the server.");
      continue;
    }
    const status = String(body.status);
    opts.onStatus?.(status);
    if (status === "done") return body.result as Extraction;
    if (status === "error") throw errorOf(body, 200);
  }
  throw new ApiError("timeout", "The reading took too long.");
}
