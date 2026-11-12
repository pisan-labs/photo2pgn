// Daily: delete conversion records older than a day and finished counters.
import type { Config } from "@netlify/functions";
import { cleanupJobs, cleanupQuota } from "../lib/handlers";
import { netlifyDeps } from "../lib/netlify-deps";

export default async () => {
  const deps = netlifyDeps();
  const jobs = await cleanupJobs(deps);
  const counters = await cleanupQuota(deps);
  console.log(`cleanup: removed ${jobs} old jobs and ${counters} old counters`);
};

export const config: Config = { schedule: "@daily" };
