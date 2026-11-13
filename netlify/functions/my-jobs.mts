// A signed-in person's readings by the HintWise reader: list them, and forget
// one once its game is in My games (or its failure has been seen).
import type { Config, Context } from "@netlify/functions";
import { handleMyJobs } from "../lib/handlers";
import { netlifyDeps } from "../lib/netlify-deps";

export default async (req: Request, context: Context) => handleMyJobs(req, context.params.id, netlifyDeps());

export const config: Config = { path: ["/api/my-jobs", "/api/my-jobs/:id"], method: ["GET", "DELETE"] };
