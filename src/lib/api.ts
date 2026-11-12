// Browser side of the conversion API.
import type { Extraction } from "./schema";

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

export interface QuotaInfo {
  freeAvailable: boolean;
  signedIn: boolean;
  quota: QuotaStatus | null;
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public quota?: QuotaStatus,
  ) {
    super(message);
  }
}

export type Mode = "free" | "own-key";

async function parse(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError("bad_response", `The server answered with HTTP ${res.status}.`);
  }
}

export async function fetchQuota(): Promise<QuotaInfo | null> {
  try {
    const res = await fetch("/api/quota", { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    return (await parse(res)) as QuotaInfo;
  } catch {
    return null;
  }
}

export async function startConversion(
  images: { mediaType: string; data: string }[],
  mode: Mode,
  apiKey?: string,
): Promise<{ jobId: string; viewToken: string; quota: QuotaStatus | null }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (mode === "own-key" && apiKey) headers["x-anthropic-key"] = apiKey;
  let res: Response;
  try {
    res = await fetch("/api/convert", { method: "POST", headers, body: JSON.stringify({ mode, images }) });
  } catch {
    throw new ApiError("network", "Could not reach the server. Check your connection and try again.");
  }
  const body = await parse(res);
  if (!res.ok) throw new ApiError(body.error?.code ?? "error", body.error?.message ?? `HTTP ${res.status}`, body.quota);
  return body;
}

export async function waitForJob(
  jobId: string,
  viewToken: string,
  opts: { signal?: AbortSignal; intervalMs?: number; timeoutMs?: number } = {},
): Promise<Extraction> {
  const interval = opts.intervalMs ?? 2500;
  const deadline = Date.now() + (opts.timeoutMs ?? 17 * 60 * 1000);
  let failures = 0;
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) throw new ApiError("cancelled", "Cancelled.");
    await new Promise((r) => setTimeout(r, interval));
    let body: any;
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}?token=${encodeURIComponent(viewToken)}`, {
        signal: opts.signal,
      });
      body = await parse(res);
      if (!res.ok) throw new ApiError(body.error?.code ?? "error", body.error?.message ?? `HTTP ${res.status}`);
      failures = 0;
    } catch (err) {
      if (opts.signal?.aborted) throw new ApiError("cancelled", "Cancelled.");
      if (err instanceof ApiError && err.code === "not_found") throw err;
      if (++failures >= 5) throw new ApiError("network", "Lost contact with the server.");
      continue;
    }
    if (body.status === "done") return body.result as Extraction;
    if (body.status === "error") throw new ApiError(body.error?.code ?? "error", body.error?.message ?? "Failed.");
  }
  throw new ApiError("timeout", "The conversion took too long.");
}
