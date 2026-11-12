// Wires the queue handlers to Netlify Blobs and HintWise sign-in.
import { loadConfig } from "./config";
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
  };
}
