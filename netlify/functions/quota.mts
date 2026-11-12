import type { Config, Context } from "@netlify/functions";
import { handleQuota } from "../lib/handlers";
import { netlifyDeps } from "../lib/netlify-deps";

export default async (req: Request, context: Context) => handleQuota(req, context.ip, netlifyDeps(req));

export const config: Config = { path: "/api/quota", method: "GET" };
