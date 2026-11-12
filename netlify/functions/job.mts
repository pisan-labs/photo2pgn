import type { Config, Context } from "@netlify/functions";
import { handleJob } from "../lib/handlers";
import { netlifyDeps } from "../lib/netlify-deps";

export default async (req: Request, context: Context) => handleJob(req, context.params.id, netlifyDeps());

export const config: Config = { path: "/api/jobs/:id", method: ["GET", "DELETE"] };
