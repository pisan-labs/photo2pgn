// Browser side of the queue for the HintWise reader (the owner's CLI): queue
// photos, list the person's readings, forget one once collected.
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
  createdAt?: string;
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

/** One of the signed-in person's readings by the HintWise reader. */
export interface MyJob {
  id: string;
  status: "queued" | "running" | "done" | "error";
  createdAt: string;
  updatedAt: string;
  imageCount: number;
  result?: Extraction;
  error?: { code: string; message: string };
}

/** The signed-in person's readings, oldest first. */
export async function listMyJobs(token: string, doFetch: typeof fetch = fetch): Promise<MyJob[]> {
  let res: Response;
  try {
    res = await doFetch("/api/my-jobs", { headers: { authorization: `Bearer ${token}` } });
  } catch {
    throw new ApiError("network", "Could not reach the server.");
  }
  const body = await parse(res);
  if (!res.ok) throw errorOf(body, res.status);
  return (body.jobs ?? []) as MyJob[];
}

/** Forget a reading on the server (its game is saved, or its failure seen); one still waiting is cancelled. */
export async function forgetJob(id: string, token: string, doFetch: typeof fetch = fetch): Promise<void> {
  let res: Response;
  try {
    res = await doFetch(`/api/my-jobs/${encodeURIComponent(id)}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
  } catch {
    throw new ApiError("network", "Could not reach the server.");
  }
  if (!res.ok && res.status !== 404) throw errorOf(await parse(res), res.status);
}
