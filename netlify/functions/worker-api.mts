// Endpoints for the owner's CLI reader (cli/pgn-worker.mjs). Disabled unless
// PGN_WORKER_TOKEN is set.
import type { Config, Context } from "@netlify/functions";
import { handleWorkerClaim, handleWorkerList, handleWorkerResult } from "../lib/handlers";
import { netlifyDeps } from "../lib/netlify-deps";

export default async (req: Request, context: Context) => {
  const deps = netlifyDeps(req);
  const path = new URL(req.url).pathname;
  if (path === "/api/worker/jobs" && req.method === "GET") return handleWorkerList(req, deps);
  if (path.endsWith("/claim") && req.method === "POST") return handleWorkerClaim(req, context.params.id, deps);
  if (path.endsWith("/result") && req.method === "POST") return handleWorkerResult(req, context.params.id, deps);
  return new Response("not found", { status: 404 });
};

export const config: Config = {
  path: ["/api/worker/jobs", "/api/worker/jobs/:id/claim", "/api/worker/jobs/:id/result"],
};
