// Queue photos for the owner's CLI reader (signed-in visitors only).
import type { Config } from "@netlify/functions";
import { handleConvert } from "../lib/handlers";
import { netlifyDeps } from "../lib/netlify-deps";

export default async (req: Request) => handleConvert(req, netlifyDeps());

export const config: Config = { path: "/api/convert", method: "POST" };
