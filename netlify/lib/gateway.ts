// photo2pgn's server asks the HintWise gateway about one person, with that
// person's own sign-in token, as their browser would. Owner, 13 Nov: a sheet
// costs one credit however it is read, and the gateway counts a credit per
// call it passes to Claude. So for a sheet the HintWise reader read, the
// server makes the smallest call the gateway counts (one output token).
// The check is the gateway's check mode, which costs nothing. No key here:
// the gateway holds it.
import { creditsOf, isAllowance } from "../../src/lib/balance";

export const APP = "photo2pgn";

export interface Balance {
  allowed: boolean;
  /** Free and bought credits left; null when the gateway does not say. */
  left: number | null;
}

export type Charge = "charged" | "out" | "error";

export interface GatewayClient {
  /** The person's credits; null when the gateway could not be asked. */
  balance(token: string): Promise<Balance | null>;
  /** Take one credit for a sheet the HintWise reader read. */
  charge(token: string, jobId: string): Promise<Charge>;
}

export function hintwiseGateway(url: string, model: string, doFetch: typeof fetch = fetch): GatewayClient {
  const post = (token: string, body: object) =>
    doFetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ app: APP, ...body }),
    });
  return {
    async balance(token) {
      try {
        const res = await post(token, { check: true });
        const data: unknown = res.ok ? await res.json() : null;
        if (!isAllowance(data)) return null;
        const c = creditsOf(data);
        return { allowed: !c.out, left: c.left };
      } catch {
        return null;
      }
    },
    async charge(token, jobId) {
      try {
        const res = await post(token, {
          model,
          max_tokens: 1,
          messages: [{ role: "user", content: `Reply OK. (photo2pgn: one credit for scoresheet ${jobId}, read by the HintWise reader.)` }],
        });
        if (res.ok) return "charged";
        const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
        if (res.status === 429 && data?.error === "cap") return "out";
        console.error("gateway: charge failed", jobId, res.status);
        return "error";
      } catch (err) {
        console.error("gateway: charge failed", jobId, err instanceof Error ? err.message : err);
        return "error";
      }
    },
  };
}
