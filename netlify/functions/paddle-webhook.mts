// Paddle's notification destination: records completed purchases.
import type { Config, Context } from "@netlify/functions";
import { handlePaddleWebhook, paddleConfigFrom, paddleIps } from "../lib/paddle";
import { blobsKV } from "../lib/kv";

// Kept while the function instance is warm, so most deliveries do not ask Paddle again.
const allowedIps = paddleIps();

export default async (req: Request, context: Context) =>
  handlePaddleWebhook(req, { config: paddleConfigFrom(), payments: blobsKV("payments"), clientIp: context.ip ?? null, allowedIps });

export const config: Config = { path: "/api/paddle-webhook", method: "POST" };
