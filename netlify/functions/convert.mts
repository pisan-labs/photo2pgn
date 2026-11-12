import type { Config, Context } from "@netlify/functions";
import { handleConvert } from "../lib/handlers";
import { netlifyDeps } from "../lib/netlify-deps";

export default async (req: Request, context: Context) => handleConvert(req, context.ip, netlifyDeps(req));

export const config: Config = { path: "/api/convert", method: "POST" };
