// Paddle's webhook, as a record of what was bought. Nothing here grants
// credits: the owner adds them by hand with the HintWise `credits-grant`
// function (owner, 13 Nov), and GET /api/worker/payments lists what is still
// owed. Only Paddle's addresses (its /ips list) get in; the signature is
// checked on the raw body before anything else is read.
import type { KV } from "./kv";
import { CREDIT_PACKS, PADDLE_APP_TAG } from "../../src/lib/credits";

export interface PaddleConfig {
  webhookSecret: string | null; // PGN_PADDLE_WEBHOOK_SECRET: the notification destination's secret, not the API key
  prices: Record<string, string>; // pack id -> Paddle price id (PGN_PADDLE_PRICE_PACK_20 ...)
}

export function paddleConfigFrom(env: Record<string, string | undefined> = process.env): PaddleConfig {
  const prices: Record<string, string> = {};
  for (const p of CREDIT_PACKS) {
    const v = env[`PGN_PADDLE_PRICE_${p.id.replace(/-/g, "_").toUpperCase()}`]?.trim();
    if (v) prices[p.id] = v;
  }
  return { webhookSecret: env.PGN_PADDLE_WEBHOOK_SECRET?.trim() || null, prices };
}

export interface Payment {
  transactionId: string;
  customerId: string | null;
  priceIds: string[];
  /** From the price ids, not from what the browser sent; null when no price is a known pack. */
  pack: string | null;
  credits: number | null;
  /** What the browser said at checkout (checkable in Paddle, not trusted). */
  userId: string | null;
  email: string | null;
  total: string | null;
  currency: string | null;
  completedAt: string;
  grantedAt: string | null;
}

const TOLERANCE_S = 300;
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** Paddle-Signature: `ts=<unix>;h1=<hmac-sha256 hex of "<ts>:<raw body>">`. */
export async function validSignature(raw: string, header: string | null, secret: string, nowS: number): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(";").map((kv) => kv.split("=") as [string, string]));
  const ts = Number(parts.ts);
  if (!Number.isFinite(ts) || !parts.h1 || Math.abs(nowS - ts) > TOLERANCE_S) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}:${raw}`)));
  if (mac.length !== parts.h1.length) return false;
  let diff = 0;
  for (let i = 0; i < mac.length; i++) diff |= mac.charCodeAt(i) ^ parts.h1.charCodeAt(i);
  return diff === 0;
}

export interface PaddleDeps {
  config: PaddleConfig;
  payments: KV;
  now?: () => Date;
}

/** Paddle's live list of the addresses it sends webhooks from: the source of truth, and it can change. */
export const PADDLE_IPS_URL = "https://api.paddle.com/ips";

/** Paddle's webhook addresses (`data.ipv4_cidrs`), kept for an hour; a stale list beats none, and none is null. */
export function paddleIps(fetcher: typeof fetch = fetch, ttlMs = 3_600_000): (nowMs?: number) => Promise<string[] | null> {
  let cache: { cidrs: string[]; at: number } | null = null;
  return async (nowMs = Date.now()) => {
    if (cache && nowMs - cache.at < ttlMs) return cache.cidrs;
    try {
      const res = await fetcher(PADDLE_IPS_URL);
      if (!res.ok) throw new Error(`ips ${res.status}`);
      const cidrs = ((await res.json()) as { data?: { ipv4_cidrs?: unknown } }).data?.ipv4_cidrs;
      if (!Array.isArray(cidrs) || !cidrs.length || !cidrs.every((c) => typeof c === "string")) throw new Error("ips shape");
      cache = { cidrs, at: nowMs };
      return cidrs;
    } catch {
      return cache?.cidrs ?? null;
    }
  };
}

const ipv4 = (s: string): number | null => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const [a, b, c, d] = m.slice(1).map(Number);
  return [a, b, c, d].some((x) => x > 255) ? null : ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
};

/** Whether an IPv4 address (or an IPv4-mapped IPv6 one) is in one of the CIDR blocks. */
export function inCidrs(ip: string, cidrs: string[]): boolean {
  const addr = ipv4(ip.replace(/^::ffff:/i, ""));
  if (addr === null) return false;
  return cidrs.some((cidr) => {
    const [base, bitsText = "32"] = cidr.split("/");
    const net = ipv4(base);
    const bits = Number(bitsText);
    if (net === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return ((addr & mask) >>> 0) === ((net & mask) >>> 0);
  });
}

export interface WebhookDeps extends PaddleDeps {
  /** The sender's address (Netlify's context.ip). */
  clientIp: string | null;
  /** Paddle's current webhook addresses (paddleIps()), null when they cannot be had. */
  allowedIps: () => Promise<string[] | null>;
}

const reply = (status: number, body: object) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

interface TxnData {
  id?: string;
  customer_id?: string | null;
  subscription_id?: string | null;
  currency_code?: string;
  custom_data?: Record<string, unknown> | null;
  items?: { price?: { id?: string } }[];
  details?: { totals?: { grand_total?: string } };
}

/** POST /api/paddle-webhook */
export async function handlePaddleWebhook(req: Request, deps: WebhookDeps): Promise<Response> {
  const { config } = deps;
  if (!config.webhookSecret) return reply(503, { error: "off" });
  // Only Paddle's servers (owner, 15 Nov, from Paddle's go-live steps). Without the list,
  // a 503: Paddle retries. Another sender gets a 403 before anything else is read.
  const cidrs = await deps.allowedIps();
  if (!cidrs) return reply(503, { error: "ips" });
  if (!deps.clientIp || !inCidrs(deps.clientIp, cidrs)) return reply(403, { error: "ip" });
  const raw = await req.text(); // the raw body: a parsed and re-written one would not verify
  const now = deps.now?.() ?? new Date();
  if (!(await validSignature(raw, req.headers.get("paddle-signature"), config.webhookSecret, Math.floor(now.getTime() / 1000)))) {
    return reply(401, { error: "signature" }); // not a 2xx, so a real delivery is retried
  }
  let event: { event_type?: string; data?: TxnData };
  try {
    event = JSON.parse(raw);
  } catch {
    return reply(400, { error: "body" });
  }
  const id = event.data?.id;
  if (event.event_type !== "transaction.completed" || !event.data || !id) return reply(200, { ignored: true });

  const d = event.data;
  const cd = d.custom_data ?? {};
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  // The Paddle account also sells mychessmaster.net memberships (28 Nov), and Paddle sends
  // every destination every event. Another app's sale is answered 200, so Paddle stops
  // retrying, and nothing of it is kept or echoed: one another checkout tagged, or an untagged
  // one made for a subscription (photo2pgn sells only one-time packs; mychessmaster.net's
  // payment-method change is a subscription transaction with no custom data). A photo2pgn tag
  // always keeps the sale, and an untagged one-time sale is kept as before.
  const app = str(cd.app);
  if (app !== PADDLE_APP_TAG && (app || str(d.subscription_id))) return reply(200, { ignored: true, reason: "other app" });

  const priceIds = (d.items ?? []).map((i) => i.price?.id).filter((x): x is string => Boolean(x));
  const pack = CREDIT_PACKS.find((p) => priceIds.includes(config.prices[p.id] ?? "\0")) ?? null;
  const payment: Payment = {
    transactionId: id,
    customerId: d.customer_id ?? null,
    priceIds,
    pack: pack?.id ?? null,
    credits: pack?.credits ?? null,
    userId: str(cd.user_id),
    email: str(cd.email),
    total: d.details?.totals?.grand_total ?? null,
    currency: d.currency_code ?? null,
    completedAt: now.toISOString(),
    grantedAt: null,
  };
  // At-least-once delivery: the transaction id is the key, a repeat changes nothing.
  const created = await deps.payments.setJSON(`payment/${id}`, payment, { onlyIfNew: true });
  return reply(200, { recorded: created });
}

/** GET /api/worker/payments (owner's token): bought and not yet marked as granted. */
export async function handlePayments(owner: boolean, deps: PaddleDeps): Promise<Response> {
  if (!owner) return reply(401, { error: "unauthorized" });
  const out: Payment[] = [];
  for (const key of await deps.payments.list("payment/")) {
    const p = await deps.payments.getJSON<Payment>(key);
    if (p && !p.value.grantedAt) out.push(p.value);
  }
  out.sort((a, b) => a.completedAt.localeCompare(b.completedAt));
  return reply(200, { payments: out });
}

/** POST /api/worker/payments/:id/granted (owner's token): after the credits are added by hand. */
export async function handlePaymentGranted(owner: boolean, id: string | undefined, deps: PaddleDeps): Promise<Response> {
  if (!owner) return reply(401, { error: "unauthorized" });
  const cur = id ? await deps.payments.getJSON<Payment>(`payment/${id}`) : null;
  if (!cur) return reply(404, { error: "not_found" });
  if (cur.value.grantedAt) return reply(200, { already: true });
  const grantedAt = (deps.now?.() ?? new Date()).toISOString();
  await deps.payments.setJSON(`payment/${id}`, { ...cur.value, grantedAt }, { onlyIfMatch: cur.etag });
  return reply(200, { grantedAt });
}
