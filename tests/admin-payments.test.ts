// The admin panel's payments route: a HintWise admin, with their own sign-in,
// lists the payments still owed and grants them (credits-grant first, then
// the mark). The gateway and credits-grant are fakes; no network.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { memoryKV, type KV } from "../netlify/lib/kv";
import { gatewayUrlOf, grantUrlOf, loadConfig } from "../netlify/lib/config";
import { handlePaymentGranted, handlePayments, type Payment } from "../netlify/lib/paddle";
import {
  GRANT_CLAIM_MS,
  creditsGrantClient,
  gatewayAdminCheck,
  handleAdminPayments,
  type AdminCheck,
  type AdminPaymentsDeps,
  type CreditsGrant,
  type GrantOutcome,
} from "../netlify/lib/admin-payments";

const NOW = new Date("2026-11-28T18:00:00Z");
const BASE = "https://photo2pgn.test/api/admin/payments";

const payment = (id: string, partial: Partial<Payment> = {}): Payment => ({
  transactionId: id,
  customerId: "ctm_1",
  priceIds: ["pri_50"],
  pack: "pack-50",
  credits: 50,
  userId: "u1",
  email: "kai@example.com",
  total: "1000",
  currency: "USD",
  completedAt: "2026-11-28T10:00:00.000Z",
  grantedAt: null,
  ...partial,
});

const admins: Record<string, Awaited<ReturnType<AdminCheck>>> = { "admin-tok": "admin", "member-tok": "not_admin", "old-tok": "signed_out", "down-tok": "unreachable" };

function setup(opts: { grant?: CreditsGrant; payments?: KV; now?: () => Date } = {}) {
  const payments = opts.payments ?? memoryKV();
  const isAdmin = vi.fn<AdminCheck>(async (token) => admins[token] ?? "signed_out");
  const grant = vi.fn<CreditsGrant>(opts.grant ?? (async (_t, g) => ({ ok: true, email: g.email, balance: 62 })));
  const deps: AdminPaymentsDeps = { payments, isAdmin, grant, now: opts.now ?? (() => NOW) };
  const call = async (path = "", method = "GET", token: string | null = "admin-tok") => {
    const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
    const res = await handleAdminPayments(new Request(`${BASE}${path}`, { method, headers }), deps);
    return { status: res.status, body: (await res.json()) as Record<string, unknown> & { error?: { code: string; message: string } } };
  };
  const put = (p: Payment) => payments.setJSON(`payment/${p.transactionId}`, p);
  const get = async (id: string) => (await payments.getJSON<Payment>(`payment/${id}`))?.value;
  return { deps, payments, isAdmin, grant, call, put, get };
}

const ids = (body: Record<string, unknown>) => (body.payments as Payment[]).map((p) => p.transactionId);

describe("who gets in", () => {
  it("lets a HintWise admin in, asking the gateway with the caller's own token", async () => {
    const { call, isAdmin } = setup();
    expect((await call()).status).toBe(200);
    expect(isAdmin).toHaveBeenCalledWith("admin-tok");
  });

  it("refuses a signed-in person who is not an admin, on every route, and grants nothing", async () => {
    const { call, put, get, grant } = setup();
    await put(payment("txn_1"));
    for (const [path, method] of [["", "GET"], ["/txn_1/grant", "POST"], ["/txn_1/granted", "POST"], ["/nope", "GET"]]) {
      const r = await call(path, method, "member-tok");
      expect(r.status).toBe(403);
      expect(r.body.error?.message).toMatch(/Only a HintWise admin/);
    }
    expect(grant).not.toHaveBeenCalled();
    expect((await get("txn_1"))?.grantedAt).toBeNull();
  });

  it("refuses a request with no token without asking the gateway", async () => {
    const { call, isAdmin } = setup();
    for (const r of [await call("", "GET", null), await call("/txn_1/granted", "POST", null)]) {
      expect(r.status).toBe(401);
      expect(r.body.error?.code).toBe("sign_in");
    }
    expect(isAdmin).not.toHaveBeenCalled();
  });

  it("refuses a token the gateway does not take as signed out", async () => {
    const r = await setup().call("", "GET", "old-tok");
    expect(r.status).toBe(401);
    expect(r.body.error?.message).toMatch(/Sign in again/);
  });

  it("answers 503 when the gateway cannot be asked, and lists or grants nothing", async () => {
    const { call, put, grant, get } = setup();
    await put(payment("txn_1"));
    for (const [path, method] of [["", "GET"], ["/txn_1/grant", "POST"]]) {
      const r = await call(path, method, "down-tok");
      expect(r.status).toBe(503);
      expect(r.body).not.toHaveProperty("payments");
      expect(r.body.error?.message).toMatch(/Could not ask HintWise/);
    }
    expect(grant).not.toHaveBeenCalled();
    expect((await get("txn_1"))?.grantedAt).toBeNull();
  });
});

describe("the list", () => {
  it("is empty when nothing is owed", async () => {
    expect(await setup().call()).toEqual({ status: 200, body: { payments: [] } });
  });

  it("lists the open payments newest first, and leaves out the granted ones", async () => {
    const { call, put } = setup();
    await put(payment("txn_old", { completedAt: "2026-11-20T10:00:00.000Z" }));
    await put(payment("txn_new", { completedAt: "2026-11-28T10:00:00.000Z" }));
    await put(payment("txn_mid", { completedAt: "2026-11-25T10:00:00.000Z", pack: null, credits: null }));
    await put(payment("txn_done", { grantedAt: "2026-11-21T10:00:00.000Z" }));
    const r = await call();
    expect(ids(r.body)).toEqual(["txn_new", "txn_mid", "txn_old"]);
    expect((r.body.payments as Payment[])[1]).toMatchObject({ pack: null, credits: null, userId: "u1", email: "kai@example.com" });
  });

  it("refuses other methods and routes", async () => {
    const { call } = setup();
    expect((await call("", "POST")).status).toBe(405);
    expect((await call("/txn_1/grant", "GET")).status).toBe(405);
    expect((await call("/txn_1/refund", "POST")).status).toBe(404);
    expect((await call("/%E0%A4%A/granted", "POST")).status).toBe(404);
  });
});

describe("grant and mark done", () => {
  it("adds the pack's credits to the account's email through credits-grant, with the admin's token, then marks it granted", async () => {
    const { call, put, get, grant } = setup();
    await put(payment("txn_1"));
    const r = await call("/txn_1/grant", "POST");
    expect(r).toEqual({ status: 200, body: { email: "kai@example.com", balance: 62, credits: 50, grantedAt: NOW.toISOString(), already: false } });
    expect(grant).toHaveBeenCalledTimes(1);
    expect(grant).toHaveBeenCalledWith("admin-tok", { email: "kai@example.com", credits: 50, note: "Paddle txn_1 (pack-50)" });
    expect(await get("txn_1")).toMatchObject({ grantedAt: NOW.toISOString(), grantStartedAt: null, grantedCredits: 50 });
    expect(ids((await call()).body)).toEqual([]);
  });

  it("takes the number of credits from the stored pack, never from the request", async () => {
    const { deps, put, grant } = setup();
    await put(payment("txn_20", { pack: "pack-20", credits: 20 }));
    const req = new Request(`${BASE}/txn_20/grant?credits=9999`, { method: "POST", headers: { authorization: "Bearer admin-tok" }, body: JSON.stringify({ credits: 9999, email: "x@example.com" }) });
    expect((await handleAdminPayments(req, deps)).status).toBe(200);
    expect(grant.mock.calls[0][1]).toEqual({ email: "kai@example.com", credits: 20, note: "Paddle txn_20 (pack-20)" });
  });

  it("leaves the payment open, and says why in plain words, when the grant fails", async () => {
    const cases: [GrantOutcome, number, string, RegExp][] = [
      [{ ok: false, code: "not_found", status: 404 }, 409, "no_account", /No HintWise account has the email kai@example.com/],
      [{ ok: false, code: "unreachable", status: null }, 502, "grant_unreachable", /Could not reach HintWise/],
      [{ ok: false, code: "failed", status: 500 }, 502, "grant_failed", /HTTP 500/],
      [{ ok: false, code: "failed", status: null }, 502, "grant_failed", /did not add the credits\. /],
      [{ ok: false, code: "request", status: 400 }, 502, "grant_failed", /HTTP 400/],
      [{ ok: false, code: "signed_out", status: 401 }, 401, "sign_in", /Sign in again/],
      [{ ok: false, code: "admin", status: 403 }, 403, "admin", /not an admin/],
    ];
    for (const [outcome, status, code, message] of cases) {
      const { call, put, get, grant } = setup({ grant: async () => outcome });
      await put(payment("txn_1"));
      const r = await call("/txn_1/grant", "POST");
      expect(r.status).toBe(status);
      expect(r.body.error?.code).toBe(code);
      expect(r.body.error?.message).toMatch(message);
      expect(r.body.error?.message).toMatch(/still open/);
      const p = await get("txn_1");
      expect(p?.grantedAt).toBeNull();
      expect(p?.grantStartedAt).toBeNull(); // the claim is given back: it can be tried again
      expect(ids((await call()).body)).toEqual(["txn_1"]);
      expect(grant).toHaveBeenCalledTimes(1);
    }
  });

  it("can be tried again after a failed grant, and then grants once", async () => {
    let fails = true;
    const { call, put, get, grant } = setup({ grant: async (_t, g) => (fails ? { ok: false, code: "unreachable", status: null } : { ok: true, email: g.email, balance: 50 }) });
    await put(payment("txn_1"));
    expect((await call("/txn_1/grant", "POST")).status).toBe(502);
    fails = false;
    expect((await call("/txn_1/grant", "POST")).status).toBe(200);
    expect(grant).toHaveBeenCalledTimes(2);
    expect((await get("txn_1"))?.grantedAt).toBe(NOW.toISOString());
  });

  it("does not grant again once the payment is marked", async () => {
    const { call, put, grant } = setup();
    await put(payment("txn_1"));
    await call("/txn_1/grant", "POST");
    expect(await call("/txn_1/grant", "POST")).toEqual({ status: 200, body: { already: true, grantedAt: NOW.toISOString() } });
    expect(grant).toHaveBeenCalledTimes(1);
  });

  it("refuses an entry with no pack or no account email, and grants nothing", async () => {
    const { call, put, get, grant } = setup();
    await put(payment("txn_other", { pack: null, credits: null, priceIds: ["pri_other"] }));
    await put(payment("txn_untagged", { userId: null, email: null }));
    const noPack = await call("/txn_other/grant", "POST");
    expect(noPack.status).toBe(409);
    expect(noPack.body.error).toMatchObject({ code: "no_pack", message: expect.stringMatching(/not one of the packs.*Mark done/) });
    const noEmail = await call("/txn_untagged/grant", "POST");
    expect(noEmail.status).toBe(409);
    expect(noEmail.body.error).toMatchObject({ code: "no_email", message: expect.stringMatching(/by hand.*Mark done/) });
    expect(grant).not.toHaveBeenCalled();
    expect((await get("txn_other"))?.grantedAt).toBeNull();
    expect((await call("/nope/grant", "POST")).status).toBe(404);
  });

  it("grants once when two clicks arrive together", async () => {
    let release: (v: GrantOutcome) => void = () => undefined;
    const { call, put, grant } = setup({ grant: () => new Promise<GrantOutcome>((r) => (release = r)) });
    await put(payment("txn_1"));
    const first = call("/txn_1/grant", "POST");
    await vi.waitFor(() => expect(grant).toHaveBeenCalledTimes(1));
    const second = await call("/txn_1/grant", "POST");
    expect(second.status).toBe(409);
    expect(second.body.error?.code).toBe("busy");
    release({ ok: true, email: "kai@example.com", balance: 50 });
    expect((await first).status).toBe(200);
    expect(grant).toHaveBeenCalledTimes(1);
  });

  it("does not grant a payment whose earlier grant never finished; only Mark done is left", async () => {
    let now = NOW;
    const { call, put, get, grant } = setup({ now: () => now });
    await put(payment("txn_1", { grantStartedAt: new Date(NOW.getTime() - 30_000).toISOString() }));
    expect((await call("/txn_1/grant", "POST")).body.error?.code).toBe("busy");
    now = new Date(NOW.getTime() + GRANT_CLAIM_MS);
    const r = await call("/txn_1/grant", "POST");
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: "unfinished", message: expect.stringMatching(/28 Nov 2026, 17:59 UTC.*may or may not.*Check the balance of kai@example.com/) });
    expect(grant).not.toHaveBeenCalled();
    expect((await call("/txn_1/granted", "POST")).status).toBe(200);
    expect(await get("txn_1")).toMatchObject({ grantedAt: now.toISOString(), grantStartedAt: null });
  });

  it("refuses when the payment changes between reading it and claiming it", async () => {
    const kv = memoryKV();
    const racing: KV = { ...kv, setJSON: async (k, v, c) => (c?.onlyIfMatch ? false : kv.setJSON(k, v, c)) };
    const { call, put, grant } = setup({ payments: racing });
    await put(payment("txn_1"));
    const r = await call("/txn_1/grant", "POST");
    expect(r.status).toBe(409);
    expect(r.body.error?.code).toBe("busy");
    expect(grant).not.toHaveBeenCalled();
  });

  it("keeps the payment in the list, and says not to grant again, when the mark fails after the grant", async () => {
    const kv = memoryKV();
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failing: KV = {
      ...kv,
      setJSON: async (k, v, c) => {
        if ((v as Payment).grantedAt) throw new Error("blobs down");
        return kv.setJSON(k, v, c);
      },
    };
    const { call, put, get, grant } = setup({ payments: failing });
    await put(payment("txn_1"));
    const r = await call("/txn_1/grant", "POST");
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ error: { code: "not_marked", message: expect.stringMatching(/were added to kai@example.com \(balance now 62\).*do not grant it again/) }, credits: 50 });
    expect(ids((await call()).body)).toEqual(["txn_1"]); // visible, not lost
    expect((await get("txn_1"))?.grantStartedAt).toBe(NOW.toISOString()); // the claim stays: no second grant from here
    expect((await call("/txn_1/grant", "POST")).body.error?.code).toBe("busy");
    expect(grant).toHaveBeenCalledTimes(1);
    expect((await call("/txn_1/granted", "POST")).status).toBe(503); // the store still fails
    quiet.mockRestore();
  });

  it("keeps the claim when giving it back fails after a failed grant", async () => {
    const kv = memoryKV();
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let writes = 0;
    const flaky: KV = {
      ...kv,
      setJSON: async (k, v, c) => {
        if (c?.onlyIfMatch && ++writes > 1) throw new Error("blobs down");
        return kv.setJSON(k, v, c);
      },
    };
    const { call, put, get } = setup({ payments: flaky, grant: async () => ({ ok: false, code: "failed", status: 500 }) });
    await put(payment("txn_1"));
    expect((await call("/txn_1/grant", "POST")).body.error?.code).toBe("grant_failed");
    expect((await get("txn_1"))?.grantStartedAt).toBe(NOW.toISOString());
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
  });
});

describe("mark done", () => {
  it("marks once; a second mark changes nothing", async () => {
    const { call, put, get, grant } = setup();
    await put(payment("txn_1", { pack: null, credits: null }));
    expect(await call("/txn_1/granted", "POST")).toEqual({ status: 200, body: { grantedAt: NOW.toISOString(), already: false } });
    const first = await get("txn_1");
    expect(await call("/txn_1/granted", "POST")).toEqual({ status: 200, body: { grantedAt: NOW.toISOString(), already: true } });
    expect(await get("txn_1")).toEqual(first);
    expect(first).not.toHaveProperty("grantedCredits");
    expect(grant).not.toHaveBeenCalled();
    expect(ids((await call()).body)).toEqual([]);
  });

  it("answers 404 for a payment it does not have", async () => {
    expect((await setup().call("/nope/granted", "POST")).status).toBe(404);
  });

  it("is tried again when another write lands first", async () => {
    const kv = memoryKV();
    let lost = 1;
    const racing: KV = { ...kv, setJSON: async (k, v, c) => (c?.onlyIfMatch && lost-- > 0 ? false : kv.setJSON(k, v, c)) };
    const { call, put, get } = setup({ payments: racing });
    await put(payment("txn_1"));
    expect((await call("/txn_1/granted", "POST")).status).toBe(200);
    expect((await get("txn_1"))?.grantedAt).toBe(NOW.toISOString());
  });

  it("gives up after three lost writes and leaves the payment open", async () => {
    const kv = memoryKV();
    const racing: KV = { ...kv, setJSON: async (k, v, c) => (c?.onlyIfMatch ? false : kv.setJSON(k, v, c)) };
    const { call, put, get } = setup({ payments: racing });
    await put(payment("txn_1"));
    expect((await call("/txn_1/granted", "POST")).status).toBe(503);
    expect((await get("txn_1"))?.grantedAt).toBeNull();
  });

  it("leaves the owner's worker-token routes as they were", async () => {
    const { call, put, deps } = setup();
    await put(payment("txn_a", { completedAt: "2026-11-20T10:00:00.000Z" }));
    await put(payment("txn_b", { completedAt: "2026-11-28T10:00:00.000Z" }));
    const worker = { config: { webhookSecret: null, prices: {} }, payments: deps.payments, now: () => NOW };
    expect(((await (await handlePayments(true, worker)).json()) as { payments: Payment[] }).payments.map((p) => p.transactionId)).toEqual(["txn_a", "txn_b"]); // oldest first there
    expect(ids((await call()).body)).toEqual(["txn_b", "txn_a"]); // newest first here
    expect((await handlePaymentGranted(false, "txn_a", worker)).status).toBe(401);
    expect((await handlePaymentGranted(true, "txn_a", worker)).status).toBe(200);
    expect(ids((await call()).body)).toEqual(["txn_b"]);
  });
});

describe("the gateway's admin check", () => {
  const URL_ = "https://auth.test/functions/v1/llm-gateway";
  const allowance = (partial: object = {}) => ({ allowed: true, scope: null, resets_at: null, app_open: true, limits: [], calls_left: 2, credits: 0, ...partial });
  const answer = (status: number, body: unknown) => vi.fn(async (_u: string, _i?: RequestInit) => new Response(JSON.stringify(body), { status }));

  it("asks check mode with the caller's token and reads admin: true", async () => {
    const f = answer(200, allowance({ admin: true }));
    expect(await gatewayAdminCheck(URL_, f as unknown as typeof fetch)("tok")).toBe("admin");
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(URL_);
    expect(new Headers(init!.headers).get("authorization")).toBe("Bearer tok");
    expect(JSON.parse(String(init!.body))).toEqual({ app: "photo2pgn", check: true });
  });

  it("takes anything but admin: true as not an admin", async () => {
    for (const body of [allowance(), allowance({ admin: false }), allowance({ admin: "true" }), allowance({ admin: 1, allowed: false })]) {
      expect(await gatewayAdminCheck(URL_, answer(200, body) as unknown as typeof fetch)("tok")).toBe("not_admin");
    }
  });

  it("tells a signed-out token from a gateway it cannot ask", async () => {
    const check = (f: () => Promise<Response>) => gatewayAdminCheck(URL_, f as unknown as typeof fetch)("tok");
    expect(await check(async () => new Response("{}", { status: 401 }))).toBe("signed_out");
    expect(await check(async () => new Response("{}", { status: 403 }))).toBe("unreachable"); // the app is not enabled
    expect(await check(async () => new Response("{}", { status: 500 }))).toBe("unreachable");
    expect(await check(async () => new Response(JSON.stringify({ admin: true }), { status: 200 }))).toBe("unreachable"); // not a check answer
    expect(await check(async () => new Response("not json", { status: 200 }))).toBe("unreachable");
    expect(
      await check(async () => {
        throw new TypeError("offline");
      }),
    ).toBe("unreachable");
  });
});

describe("the credits-grant client", () => {
  const URL_ = "https://auth.test/functions/v1/credits-grant";
  const answer = (status: number, body: unknown) => vi.fn(async (_u: string, _i?: RequestInit) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
  const grantWith = (f: ReturnType<typeof answer>) => creditsGrantClient(URL_, f as unknown as typeof fetch)("admin-tok", { email: "kai@example.com", credits: 50, note: "Paddle txn_1 (pack-50)" });

  it("posts the app, email, credits and note with the admin's own token", async () => {
    const f = answer(200, { email: "kai@example.com", balance: 62 });
    expect(await grantWith(f)).toEqual({ ok: true, email: "kai@example.com", balance: 62 });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(URL_);
    expect(new Headers(init!.headers).get("authorization")).toBe("Bearer admin-tok");
    expect(JSON.parse(String(init!.body))).toEqual({ app: "photo2pgn", email: "kai@example.com", credits: 50, note: "Paddle txn_1 (pack-50)" });
    expect(await grantWith(answer(200, { balance: 3 }))).toEqual({ ok: true, email: "kai@example.com", balance: 3 });
  });

  it("names each refusal", async () => {
    const cases: [number, unknown, string][] = [
      [401, { error: "auth" }, "signed_out"],
      [403, { error: "admin" }, "admin"],
      [404, { error: "not_found" }, "not_found"],
      [400, { error: "request" }, "request"],
      [500, { error: "database" }, "failed"],
      [502, "bad gateway", "failed"],
      [200, { nonsense: true }, "failed"],
    ];
    for (const [status, body, code] of cases) expect(await grantWith(answer(status, body))).toEqual({ ok: false, code, status });
    const offline = vi.fn(async () => {
      throw new TypeError("offline");
    });
    expect(await grantWith(offline as unknown as ReturnType<typeof answer>)).toEqual({ ok: false, code: "unreachable", status: null });
  });
});

describe("wiring", () => {
  it("finds the gateway and credits-grant on the configured Supabase project", () => {
    expect(grantUrlOf(loadConfig({}))).toBe("https://auth.hintwise.org/functions/v1/credits-grant");
    expect(gatewayUrlOf(loadConfig({}))).toBe("https://auth.hintwise.org/functions/v1/llm-gateway");
    expect(grantUrlOf(loadConfig({ PGN_SUPABASE_URL: "https://auth.test/" }))).toBe("https://auth.test/functions/v1/credits-grant");
  });

  it("keeps the function a thin wrapper that holds no key of its own", () => {
    const fn = readFileSync("netlify/functions/admin-payments.mts", "utf8");
    const lib = readFileSync("netlify/lib/admin-payments.ts", "utf8");
    expect(fn).toContain("handleAdminPayments(req,");
    expect(fn).toMatch(/path: \["\/api\/admin\/payments", "\/api\/admin\/payments\/:id\/grant", "\/api\/admin\/payments\/:id\/granted"\]/);
    for (const text of [fn, lib]) expect(text).not.toMatch(/ANTHROPIC_|CLAUDE_|SERVICE_ROLE|PGN_WORKER_TOKEN|process\.env/);
  });
});
