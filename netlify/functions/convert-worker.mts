// Background function: Netlify answers 202 at once and lets this run for up
// to 15 minutes, long enough for a careful read of a two-page scoresheet.
import type { Config } from "@netlify/functions";
import { runWorker, type WorkerRequest } from "../lib/handlers";
import { netlifyDeps } from "../lib/netlify-deps";

export default async (req: Request) => {
  let body: WorkerRequest;
  try {
    body = await req.json();
  } catch {
    return;
  }
  await runWorker(body, netlifyDeps(req));
};

export const config: Config = { background: true };
