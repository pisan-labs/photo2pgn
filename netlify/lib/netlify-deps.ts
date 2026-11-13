// Wires the queue handlers to Netlify Blobs, HintWise sign-in and the gateway.
import { gatewayUrlOf, loadConfig } from "./config";
import { hintwiseGateway } from "./gateway";
import { blobsKV } from "./kv";
import { supabaseVerifier } from "./auth";
import type { Deps } from "./handlers";

export function netlifyDeps(): Deps {
  const config = loadConfig();
  return {
    config,
    jobs: blobsKV("jobs"),
    quota: blobsKV("quota"),
    verifyUser: supabaseVerifier(config.supabaseUrl, config.supabaseAnonKey),
    gateway: config.chargeCredits ? hintwiseGateway(gatewayUrlOf(config), config.chargeModel) : undefined,
  };
}
