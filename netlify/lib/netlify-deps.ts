// Wires the handlers to Netlify Blobs, the background worker and Claude.
import { loadConfig } from "./config";
import { blobsKV } from "./kv";
import { readScoresheet } from "./claude";
import type { Deps, WorkerRequest } from "./handlers";

export function netlifyDeps(req: Request): Deps {
  const config = loadConfig();
  return {
    config,
    jobs: blobsKV("jobs"),
    quota: blobsKV("quota"),
    readScoresheet,
    async startWorker(body: WorkerRequest) {
      const url = new URL("/.netlify/functions/convert-worker", req.url);
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status !== 202 && !res.ok) throw new Error(`worker did not start: HTTP ${res.status}`);
    },
  };
}
