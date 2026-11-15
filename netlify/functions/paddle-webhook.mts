// Paddle's notification destination: records completed purchases.
import type { Config } from "@netlify/functions";
import { handlePaddleWebhook, paddleConfigFrom } from "../lib/paddle";
import { blobsKV } from "../lib/kv";

export default async (req: Request) =>
  handlePaddleWebhook(req, { config: paddleConfigFrom(), payments: blobsKV("payments") });

export const config: Config = { path: "/api/paddle-webhook", method: "POST" };
