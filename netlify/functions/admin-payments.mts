// The payments still owed, for a HintWise admin signed in to photo2pgn (the
// admin panel's "Payments to grant"). The handlers check the admin with the
// gateway and add credits through credits-grant, both with the caller's own
// sign-in token.
import type { Config } from "@netlify/functions";
import { creditsGrantClient, gatewayAdminCheck, handleAdminPayments } from "../lib/admin-payments";
import { gatewayUrlOf, grantUrlOf, loadConfig } from "../lib/config";
import { blobsKV } from "../lib/kv";

export default async (req: Request) => {
  const config = loadConfig();
  return handleAdminPayments(req, {
    payments: blobsKV("payments"),
    isAdmin: gatewayAdminCheck(gatewayUrlOf(config)),
    grant: creditsGrantClient(grantUrlOf(config)),
  });
};

export const config: Config = {
  path: ["/api/admin/payments", "/api/admin/payments/:id/grant", "/api/admin/payments/:id/granted"],
  method: ["GET", "POST"],
};
