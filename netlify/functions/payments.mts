// The owner's list of purchases still to be granted by hand (PGN_WORKER_TOKEN).
import type { Config, Context } from "@netlify/functions";
import { workerAuthorized } from "../lib/handlers";
import { loadConfig } from "../lib/config";
import { blobsKV } from "../lib/kv";
import { handlePaymentGranted, handlePayments, paddleConfigFrom } from "../lib/paddle";

export default async (req: Request, context: Context) => {
  const deps = { config: paddleConfigFrom(), payments: blobsKV("payments") };
  const owner = await workerAuthorized(req, loadConfig());
  return req.method === "GET" ? handlePayments(owner, deps) : handlePaymentGranted(owner, context.params.id, deps);
};

export const config: Config = {
  path: ["/api/worker/payments", "/api/worker/payments/:id/granted"],
  method: ["GET", "POST"],
};
