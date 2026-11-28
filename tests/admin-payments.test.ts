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
    expect((r.body.payments as Payment[])[1]).toMatchObject({ pack: null, credits: null, userId: "u1", email: "kai@example.com", total: "1000", currency: "USD" }); // what was paid, for the panel
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

  it("gives the claim back, and says why in plain words, when credits-grant certainly wrote nothing", async () => {
    const cases: [GrantOutcome, number, string, RegExp][] = [
      [{ ok: false, code: "not_found", status: 404 }, 409, "no_account", /No HintWise account has the email kai@example.com/],
      [{ ok: false, code: "request", status: 400 }, 502, "grant_refused", /turned the grant down: it does not take kai@example\.com with 50 credits\. No credits were added.*Mark done/],
      [{ ok: false, code: "refused", status: 404 }, 502, "grant_refused", /refused the grant \(HTTP 404\), so no credits were added.*Mark done/],
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
      expect(p?.grantStartedAt).toBeNull(); // nothing was written: the claim is given back
      expect(ids((await call()).body)).toEqual(["txn_1"]);
      expect(grant).toHaveBeenCalledTimes(1);
    }
  });

  it("keeps the claim when it is not known whether the credits went in, and never offers the grant again", async () => {
    const cases: [GrantOutcome, string, RegExp][] = [
      [{ ok: false, code: "unreachable", status: null }, "grant_unreachable", /connection to HintWise failed while the grant was being sent, so the credits may or may not have been added/],
      [{ ok: false, code: "failed", status: 500 }, "grant_unclear", /did not confirm the grant \(HTTP 500\), so the credits may or may not/],
      [{ ok: false, code: "failed", status: 504 }, "grant_unclear", /HTTP 504/],
      [{ ok: false, code: "failed", status: 200 }, "grant_unclear", /HTTP 200/],
      [{ ok: false, code: "failed", status: null }, "grant_unclear", /did not confirm the grant, so/],
    ];
    for (const [outcome, code, message] of cases) {
      let now = NOW;
      const { call, put, get, grant } = setup({ grant: async () => outcome, now: () => now });
      await put(payment("txn_1"));
      const r = await call("/txn_1/grant", "POST");
      expect(r.status).toBe(502);
      expect(r.body.error?.code).toBe(code);
      expect(r.body.error?.message).toMatch(message);
      expect(r.body.error?.message).toMatch(/Do not grant this payment again\. After 28 Nov 2026, 18:02 UTC, check the balance of kai@example\.com.*add the 50 credits by hand.*only if they are missing, then Mark done/);
      expect(await get("txn_1")).toMatchObject({ grantedAt: null, grantStartedAt: NOW.toISOString() }); // the claim stays
      expect(ids((await call()).body)).toEqual(["txn_1"]);
      expect((await call("/txn_1/grant", "POST")).body.error?.code).toBe("busy");
      now = new Date(NOW.getTime() + GRANT_CLAIM_MS);
      expect((await call("/txn_1/grant", "POST")).body.error?.code).toBe("unfinished");
      expect(grant).toHaveBeenCalledTimes(1);
      expect((await call("/txn_1/granted", "POST")).status).toBe(200); // Mark done is the way out, once the claim is old
    }
  });

  it("can be tried again after credits-grant refused it, and then grants once", async () => {
    let fails = true;
    const { call, put, get, grant } = setup({ grant: async (_t, g) => (fails ? { ok: false, code: "signed_out", status: 401 } : { ok: true, email: g.email, balance: 50 }) });
    await put(payment("txn_1"));
    expect((await call("/txn_1/grant", "POST")).status).toBe(401);
    fails = false;
    expect((await call("/txn_1/grant", "POST")).status).toBe(200);
    expect(grant).toHaveBeenCalledTimes(2);
    expect((await get("txn_1"))?.grantedAt).toBe(NOW.toISOString());
  });

  describe("with the real credits-grant client, when the grant goes in but the answer is lost", () => {
    /** A credits-grant that adds the credits and then fails to answer as told. */
    function platform(after: () => Response) {
      const balances = new Map<string, number>();
      const fetch_ = vi.fn(async (_u: string, init?: RequestInit) => {
        const g = JSON.parse(String(init!.body)) as { email: string; credits: number };
        balances.set(g.email, (balances.get(g.email) ?? 0) + g.credits);
        return after();
      });
      return { balances, fetch_, client: creditsGrantClient("https://auth.test/functions/v1/credits-grant", fetch_ as unknown as typeof fetch) };
    }
    const cases: [string, () => Response, string][] = [
      [
        "a connection dropped after sending",
        () => {
          throw new TypeError("fetch failed");
        },
        "grant_unreachable",
      ],
      ["a 504 after the commit", () => new Response("upstream timed out", { status: 504 }), "grant_unclear"],
      ["a 500 database after the commit", () => new Response(JSON.stringify({ error: "database", message: "TypeError: fetch failed" }), { status: 500 }), "grant_unclear"],
      ["a 546 from the function layer", () => new Response("", { status: 546 }), "grant_unclear"],
      ["a 200 without a balance", () => new Response(JSON.stringify({ email: "kai@example.com" }), { status: 200 }), "grant_unclear"],
    ];
    for (const [name, after, code] of cases) {
      it(`adds the credits once: ${name}`, async () => {
        const { balances, fetch_, client } = platform(after);
        let now = NOW;
        const { call, put } = setup({ grant: client, now: () => now });
        await put(payment("txn_1"));
        expect((await call("/txn_1/grant", "POST")).body.error?.code).toBe(code);
        expect((await call("/txn_1/grant", "POST")).body.error?.code).toBe("busy");
        now = new Date(NOW.getTime() + 10 * GRANT_CLAIM_MS);
        expect((await call("/txn_1/grant", "POST")).body.error?.code).toBe("unfinished");
        expect(fetch_).toHaveBeenCalledTimes(1);
        expect(balances.get("kai@example.com")).toBe(50);
      });
    }
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
    let now = NOW;
    const { call, put, get, grant } = setup({ payments: failing, now: () => now });
    await put(payment("txn_1"));
    const r = await call("/txn_1/grant", "POST");
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({
      error: { code: "not_marked", message: expect.stringMatching(/were added to kai@example.com \(balance now 62\).*Do not grant it again; press Mark done after 28 Nov 2026, 18:02 UTC/) },
      credits: 50,
    });
    expect(ids((await call()).body)).toEqual(["txn_1"]); // visible, not lost
    expect((await get("txn_1"))?.grantStartedAt).toBe(NOW.toISOString()); // the claim stays: no second grant from here
    expect((await call("/txn_1/grant", "POST")).body.error?.code).toBe("busy");
    expect(grant).toHaveBeenCalledTimes(1);
    expect((await call("/txn_1/granted", "POST")).body.error?.code).toBe("grant_running"); // the claim is still young
    now = new Date(NOW.getTime() + GRANT_CLAIM_MS);
    expect((await call("/txn_1/granted", "POST")).status).toBe(503); // the store still fails
    quiet.mockRestore();
  });

  it("keeps the claim when giving it back fails after a refused grant", async () => {
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
    const { call, put, get } = setup({ payments: flaky, grant: async () => ({ ok: false, code: "request", status: 400 }) });
    await put(payment("txn_1"));
    expect((await call("/txn_1/grant", "POST")).body.error?.code).toBe("grant_refused");
    expect((await get("txn_1"))?.grantStartedAt).toBe(NOW.toISOString());
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
  });
});

describe("a store that gives no etag", () => {
  /** A store whose reads carry no etag: a conditional write cannot be formed against it. */
  const noEtags = () => {
    const kv = memoryKV();
    const writes: { onlyIfMatch?: string; onlyIfNew?: boolean }[] = [];
    const store: KV = {
      ...kv,
      getJSON: async <T,>(k: string) => {
        const r = await kv.getJSON<T>(k);
        return r ? { value: r.value, etag: "" } : null;
      },
      setJSON: async (k, v, c) => {
        writes.push(c ?? {});
        return kv.setJSON(k, v, c);
      },
    };
    return { store, writes };
  };

  it("refuses to grant, writes nothing, and leaves Mark done", async () => {
    const { store, writes } = noEtags();
    const { call, put, get, grant } = setup({ payments: store });
    await put(payment("txn_1"));
    writes.length = 0;
    const r = await call("/txn_1/grant", "POST");
    expect(r.status).toBe(503);
    expect(r.body.error).toMatchObject({ code: "unguarded", message: expect.stringMatching(/no version.*could not be kept from running twice\. No credits were added\..*by hand.*Mark done/) });
    expect(grant).not.toHaveBeenCalled();
    expect(writes).toEqual([]); // no claim, not even an unconditional one
    expect(await get("txn_1")).toMatchObject({ grantedAt: null });
    expect((await get("txn_1"))?.grantStartedAt).toBeUndefined();
    expect((await call("/txn_1/granted", "POST")).status).toBe(200); // Mark done still works
    expect((await get("txn_1"))?.grantedAt).toBe(NOW.toISOString());
  });

  it("lets neither of two grants that arrive together through", async () => {
    const { store } = noEtags();
    const { call, put, grant } = setup({ payments: store });
    await put(payment("txn_1"));
    const [a, b] = await Promise.all([call("/txn_1/grant", "POST"), call("/txn_1/grant", "POST")]);
    expect([a.status, b.status]).toEqual([503, 503]);
    expect([a.body.error?.code, b.body.error?.code]).toEqual(["unguarded", "unguarded"]);
    expect(grant).not.toHaveBeenCalled();
  });
});

describe("a store that fails", () => {
  const quietly = async (f: () => Promise<void>) => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await f();
    } finally {
      quiet.mockRestore();
    }
  };

  it("answers the list in JSON with what it could read, and how many it could not", async () => {
    await quietly(async () => {
      const kv = memoryKV();
      const bad = new Set(["payment/txn_bad1", "payment/txn_bad2"]);
      const store: KV = {
        ...kv,
        getJSON: async <T,>(k: string) => {
          if (bad.has(k)) throw new SyntaxError("Unexpected token");
          return kv.getJSON<T>(k);
        },
      };
      const { call, put, payments } = setup({ payments: store });
      for (let i = 0; i < 12; i++) await put(payment(`txn_${String(i).padStart(2, "0")}`, { completedAt: `2026-11-${String(10 + i)}T10:00:00.000Z` }));
      await put(payment("txn_bad1"));
      await put(payment("txn_bad2"));
      await payments.setJSON("payment/txn_odd", { hello: "world" }); // not a payment
      await put(payment("txn_done", { grantedAt: "2026-11-21T10:00:00.000Z" }));
      const r = await call();
      expect(r.status).toBe(200);
      expect(r.body.unreadable).toBe(3);
      expect(ids(r.body)).toEqual(Array.from({ length: 12 }, (_, i) => `txn_${String(11 - i).padStart(2, "0")}`));
    });
  });

  it("leaves out a record removed between the listing and the read", async () => {
    const kv = memoryKV();
    const store: KV = { ...kv, list: async (p) => [...(await kv.list(p)), "payment/txn_gone"] };
    const { call, put } = setup({ payments: store });
    await put(payment("txn_1"));
    expect((await call()).body).toEqual({ payments: [expect.objectContaining({ transactionId: "txn_1" })] });
  });

  it("answers 503 in JSON when the payments cannot be listed", async () => {
    await quietly(async () => {
      const kv = memoryKV();
      const { call } = setup({
        payments: {
          ...kv,
          list: async () => {
            throw new Error("blobs down");
          },
        },
      });
      const r = await call();
      expect(r.status).toBe(503);
      expect(r.body.error).toMatchObject({ code: "store", message: expect.stringMatching(/could not be read from the store/) });
    });
  });

  it("answers 503 in JSON, and grants or marks nothing, when a payment cannot be read", async () => {
    const kv = memoryKV();
    const store: KV = {
      ...kv,
      getJSON: async () => {
        throw new Error("blobs down");
      },
    };
    const { call, grant } = setup({ payments: store });
    for (const action of ["grant", "granted"]) {
      const r = await call(`/txn_1/${action}`, "POST");
      expect(r.status).toBe(503);
      expect(r.body.error).toMatchObject({ code: "store", message: expect.stringMatching(/nothing was granted or marked/) });
    }
    expect(grant).not.toHaveBeenCalled();
  });

  it("does not grant when the claim cannot be written", async () => {
    const kv = memoryKV();
    const store: KV = {
      ...kv,
      setJSON: async (k, v, c) => {
        if (c?.onlyIfMatch) throw new Error("blobs down");
        return kv.setJSON(k, v, c);
      },
    };
    const { call, put, grant } = setup({ payments: store });
    await put(payment("txn_1"));
    const r = await call("/txn_1/grant", "POST");
    expect(r.status).toBe(503);
    expect(r.body.error).toMatchObject({ code: "store", message: expect.stringMatching(/no credits were added\. Refresh the list/) });
    expect(grant).not.toHaveBeenCalled();
  });
});

describe("mark done while a grant runs", () => {
  it("refuses Mark done while a grant claim is young, and marks once it is old", async () => {
    let now = NOW;
    const { call, put, get } = setup({ now: () => now });
    await put(payment("txn_1", { grantStartedAt: new Date(NOW.getTime() - 30_000).toISOString() }));
    const r = await call("/txn_1/granted", "POST");
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: "grant_running", message: expect.stringMatching(/started at 28 Nov 2026, 17:59 UTC and may still be running.*before 28 Nov 2026, 18:01 UTC.*check the account's balance/) });
    expect((await get("txn_1"))?.grantedAt).toBeNull();
    now = new Date(NOW.getTime() + 90_000);
    expect((await call("/txn_1/granted", "POST")).status).toBe(200);
  });

  it("refuses Mark done from the panel while another admin's grant is under way, and the grant then marks as usual", async () => {
    let release: (v: GrantOutcome) => void = () => undefined;
    const { call, put, get, grant } = setup({ grant: () => new Promise<GrantOutcome>((r) => (release = r)) });
    await put(payment("txn_1"));
    const granting = call("/txn_1/grant", "POST");
    await vi.waitFor(() => expect(grant).toHaveBeenCalledTimes(1));
    expect((await call("/txn_1/granted", "POST")).body.error?.code).toBe("grant_running");
    release({ ok: true, email: "kai@example.com", balance: 50 });
    expect(await granting).toEqual({ status: 200, body: { email: "kai@example.com", balance: 50, credits: 50, grantedAt: NOW.toISOString(), already: false } });
    expect(await get("txn_1")).toMatchObject({ grantedAt: NOW.toISOString(), grantedCredits: 50 });
  });

  it("says so when the payment was marked by someone else while the grant ran (the owner's worker route still marks)", async () => {
    let release: (v: GrantOutcome) => void = () => undefined;
    const { call, put, get, grant, deps } = setup({ grant: () => new Promise<GrantOutcome>((r) => (release = r)) });
    await put(payment("txn_1"));
    const granting = call("/txn_1/grant", "POST");
    await vi.waitFor(() => expect(grant).toHaveBeenCalledTimes(1));
    const worker = { config: { webhookSecret: null, prices: {} }, payments: deps.payments, now: () => new Date(NOW.getTime() + 5_000) };
    expect(await (await handlePaymentGranted(true, "txn_1", worker)).json()).toEqual({ grantedAt: new Date(NOW.getTime() + 5_000).toISOString() });
    release({ ok: true, email: "kai@example.com", balance: 100 });
    expect(await granting).toEqual({
      status: 200,
      body: { email: "kai@example.com", balance: 100, credits: 50, grantedAt: new Date(NOW.getTime() + 5_000).toISOString(), already: false, markedMeanwhile: true },
    });
    expect((await get("txn_1"))?.grantedAt).toBe(new Date(NOW.getTime() + 5_000).toISOString());
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
      [401, "", "signed_out"], // Supabase's own layer, before the function
      [403, { error: "admin" }, "admin"],
      [403, "forbidden", "refused"],
      [404, { error: "not_found" }, "not_found"],
      [404, { code: "NOT_FOUND", message: "Requested function was not found" }, "refused"],
      [400, { error: "request" }, "request"],
      [400, { error: "below_zero" }, "request"],
      [500, { error: "database" }, "failed"], // also what a lost answer from a committed call looks like
      [500, { error: "admin" }, "failed"],
      [502, "bad gateway", "failed"],
      [504, "", "failed"],
      [413, { error: "request" }, "failed"],
      [429, {}, "failed"],
      [200, { nonsense: true }, "failed"],
      [200, "not json", "failed"],
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
