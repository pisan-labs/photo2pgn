// Paddle's webhook, as a record of what was bought. Nothing here grants
// credits: the owner adds them by hand with the HintWise `credits-grant`
// function (owner, 13 Nov), and GET /api/worker/payments lists what is still
// owed. The signature is checked on the raw body before anything else.
import type { KV } from "./kv";
import { CREDIT_PACKS } from "../../src/lib/credits";

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

const reply = (status: number, body: object) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

interface TxnData {
  id?: string;
  customer_id?: string | null;
  currency_code?: string;
  custom_data?: Record<string, unknown> | null;
  items?: { price?: { id?: string } }[];
  details?: { totals?: { grand_total?: string } };
}

/** POST /api/paddle-webhook */
export async function handlePaddleWebhook(req: Request, deps: PaddleDeps): Promise<Response> {
  const { config } = deps;
  if (!config.webhookSecret) return reply(503, { error: "off" });
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
  const priceIds = (d.items ?? []).map((i) => i.price?.id).filter((x): x is string => Boolean(x));
  const pack = CREDIT_PACKS.find((p) => priceIds.includes(config.prices[p.id] ?? "\0")) ?? null;
  const cd = d.custom_data ?? {};
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
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
