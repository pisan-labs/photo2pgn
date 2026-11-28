// @vitest-environment jsdom
// The admin panel's "Payments to grant", rendered in jsdom against a fake
// photo2pgn server: loading, empty, error, grant then mark, a failed grant,
// Mark done with its confirmation, and the keyboard. No network.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AdminPayments } from "../src/components/AdminPayments";
import type { OwedPayment, PaymentsDeps } from "../src/lib/payments";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const owed = (id: string, partial: Partial<OwedPayment> = {}): OwedPayment => ({
  transactionId: id,
  customerId: "ctm_1",
  pack: "pack-50",
  credits: 50,
  userId: "4b1c0d2e-0000-4000-8000-000000000001",
  email: "kai@example.com",
  total: "1000",
  currency: "USD",
  completedAt: "2026-11-28T10:00:00.000Z",
  grantedAt: null,
  ...partial,
});

type Reply = { status: number; body: unknown } | "offline" | Promise<{ status: number; body: unknown }>;

/** A fake photo2pgn server: the list, and one answer per payment action, in order. */
function server(list: Reply | Reply[], actions: Record<string, Reply[]> = {}) {
  const lists = Array.isArray(list) ? [...list] : [list];
  const calls: string[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    const reply = url === "/api/admin/payments" ? (lists.length > 1 ? lists.shift()! : lists[0]) : (actions[url]?.shift() ?? { status: 500, body: {} });
    const r = await reply;
    if (r === "offline") throw new TypeError("offline");
    return new Response(JSON.stringify(r.body), { status: r.status });
  });
  const deps: PaymentsDeps = { getToken: async () => "admin-tok", fetch: fetch as unknown as typeof globalThis.fetch };
  return { deps, calls };
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const settle = () => act(async () => new Promise<void>((r) => setTimeout(r, 0)));

async function render(deps: PaymentsDeps, onGranted?: () => void) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<AdminPayments deps={deps} onGranted={onGranted} />));
  await settle();
  return host;
}

const text = () => host!.textContent ?? "";
const buttons = (scope: ParentNode = host!) => [...scope.querySelectorAll("button")];
const button = (label: string, scope: ParentNode = host!) => {
  const b = buttons(scope).find((x) => x.textContent === label);
  if (!b) throw new Error(`no button "${label}" in: ${buttons(scope).map((x) => x.textContent).join(", ")}`);
  return b;
};
const rows = () => [...host!.querySelectorAll<HTMLLIElement>("li.payment")];
const click = async (b: HTMLElement) => {
  await act(async () => b.click());
  await settle();
};
const press = async (key: string) => {
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
  await settle();
};

describe("the list's states", () => {
  it("says it is loading until the list comes, then says when nothing is waiting", async () => {
    let answer: (v: { status: number; body: unknown }) => void = () => undefined;
    const { deps } = server(new Promise((r) => (answer = r)));
    await render(deps);
    expect(host!.querySelector('[role="status"].hint')?.textContent).toBe("Loading the payments…");
    await act(async () => answer({ status: 200, body: { payments: [] } }));
    await settle();
    expect(text()).not.toContain("Loading");
    expect(text()).toContain("No payments are waiting. Every sale so far is marked done.");
    expect(rows()).toHaveLength(0);
  });

  it("says why the list did not load, and loads it again on Try again", async () => {
    const { deps, calls } = server([{ status: 403, body: { error: { code: "admin", message: "Only a HintWise admin can see the payments." } } }, { status: 200, body: { payments: [owed("txn_1")] } }]);
    await render(deps);
    expect(host!.querySelector('[role="alert"]')?.textContent).toBe("Only a HintWise admin can see the payments.");
    await click(button("Try again"));
    expect(rows()).toHaveLength(1);
    expect(host!.querySelector('[role="alert"]')).toBeNull();
    expect(calls.filter((c) => c === "GET /api/admin/payments")).toHaveLength(2);
  });

  it("says how many payment records could not be read", async () => {
    const { deps } = server([
      { status: 200, body: { payments: [owed("txn_1")], unreadable: 2 } },
      { status: 200, body: { payments: [], unreadable: 1 } },
    ]);
    await render(deps);
    expect(host!.querySelector('[role="alert"]')?.textContent).toBe("2 payment records could not be read just now, so they are not listed. Refresh to try again.");
    expect(rows()).toHaveLength(1);
    await click(button("Refresh"));
    expect(host!.querySelector('[role="alert"]')?.textContent).toBe("1 payment record could not be read just now, so it is not listed. Refresh to try again.");
    expect(text()).not.toContain("No payments are waiting");
  });

  it("says so in plain words when the server cannot be reached", async () => {
    await render(server("offline").deps);
    expect(host!.querySelector('[role="alert"]')?.textContent).toMatch(/Could not reach Photo to PGN/);
  });

  it("shows each payment in the order the server gives (newest first): when, pack, account and Paddle ids", async () => {
    const { deps } = server({
      status: 200,
      body: { payments: [owed("txn_new"), owed("txn_old", { pack: "pack-20", credits: 20, email: null, completedAt: "2026-11-20T10:00:00.000Z" }), owed("txn_none", { userId: null, email: null, pack: null, credits: null, customerId: null })] },
    });
    await render(deps);
    const [a, b, c] = rows();
    expect(text()).toContain("3 payments to grant.");
    expect(a.textContent).toContain("50 credits (US$10 pack)");
    expect(a.textContent).toContain("PaidUS$10.00");
    expect(a.textContent).not.toContain("less than the list price");
    expect(a.textContent).toContain("kai@example.com");
    expect(a.textContent).toContain("user id 4b1c0d2e-0000-4000-8000-000000000001");
    expect(a.textContent).toContain("txn_new");
    expect(a.textContent).toContain("customer ctm_1");
    expect(b.textContent).toContain("20 credits (US$5 pack)");
    expect(b.textContent).toContain("user id 4b1c0d2e"); // no email: the user id
    expect(b.textContent).toMatch(/did not carry the account's email/);
    expect(buttons(b).map((x) => x.textContent)).toEqual(["Mark done"]);
    expect(c.textContent).toContain("Not one of the packs");
    expect(c.textContent).toContain("Not named at checkout");
    expect(buttons(c).map((x) => x.textContent)).toEqual(["Mark done"]); // no pack: Mark done only
    expect(buttons(a).map((x) => x.textContent)).toEqual(["Grant and mark done", "Mark done"]);
    // Each action button is described by its row, for a screen reader.
    const described = button("Grant and mark done", a).getAttribute("aria-describedby")!;
    expect(host!.querySelector(`#${described}`)?.textContent).toContain("50 credits");
  });
});

describe("Grant and mark done", () => {
  it("grants, takes the row away, says what was added, and moves focus to that message", async () => {
    const onGranted = vi.fn();
    const { deps, calls } = server(
      { status: 200, body: { payments: [owed("txn_1"), owed("txn_2")] } },
      { "/api/admin/payments/txn_1/grant": [{ status: 200, body: { email: "kai@example.com", balance: 62, credits: 50, already: false, grantedAt: "x" } }] },
    );
    await render(deps, onGranted);
    await click(button("Grant and mark done", rows()[0]));
    expect(calls).toContain("POST /api/admin/payments/txn_1/grant");
    expect(rows().map((r) => r.textContent).join()).not.toContain("txn_1");
    expect(rows()).toHaveLength(1);
    const notice = host!.querySelector(".payments-notice")!;
    expect(notice.textContent).toBe("Added 50 credits to kai@example.com (balance now 62), and marked the payment done.");
    expect(notice.getAttribute("role")).toBe("status");
    expect(document.activeElement).toBe(notice);
    expect(onGranted).toHaveBeenCalledTimes(1);
  });

  it("keeps the payment when the grant fails, and says why in the row", async () => {
    const onGranted = vi.fn();
    const why = "No HintWise account has the email kai@example.com, so no credits were added. The payment is still open.";
    const { deps } = server({ status: 200, body: { payments: [owed("txn_1")] } }, { "/api/admin/payments/txn_1/grant": [{ status: 409, body: { error: { code: "no_account", message: why } } }] });
    await render(deps, onGranted);
    await click(button("Grant and mark done"));
    expect(rows()).toHaveLength(1);
    expect(rows()[0].querySelector('[role="alert"]')?.textContent).toBe(why);
    expect(buttons(rows()[0]).map((x) => x.textContent)).toEqual(["Grant and mark done", "Mark done"]); // it can be tried again
    expect(onGranted).not.toHaveBeenCalled();
    expect(document.activeElement?.textContent).toBe("Mark done");
  });

  it("keeps a row's error while another row is acted on, and clears it when that row is tried again", async () => {
    const why = "Your sign-in has run out, so no credits were added. The payment is still open. Sign in again and retry.";
    const { deps } = server(
      { status: 200, body: { payments: [owed("txn_1"), owed("txn_2")] } },
      { "/api/admin/payments/txn_1/grant": [{ status: 401, body: { error: { code: "sign_in", message: why } } }, new Promise(() => undefined)] },
    );
    await render(deps);
    await click(button("Grant and mark done", rows()[0]));
    await click(button("Mark done", rows()[1]));
    expect(rows()[0].querySelector('[role="alert"]')?.textContent).toBe(why);
    await click(button("Cancel", rows()[1]));
    await click(button("Grant and mark done", rows()[0]));
    expect(rows()[0].querySelector('[role="alert"]')).toBeNull();
  });

  it("offers only Mark done once the credits went in but the mark did not", async () => {
    const why = "The 50 credits were added to kai@example.com (balance now 62), but the payment could not be marked done. Press Mark done; do not grant it again.";
    const { deps } = server(
      { status: 200, body: { payments: [owed("txn_1")] } },
      { "/api/admin/payments/txn_1/grant": [{ status: 500, body: { error: { code: "not_marked", message: why } } }], "/api/admin/payments/txn_1/granted": [{ status: 200, body: { grantedAt: "x", already: false } }] },
    );
    await render(deps);
    await click(button("Grant and mark done"));
    expect(rows()[0].textContent).toContain(why);
    expect(buttons(rows()[0]).map((x) => x.textContent)).toEqual(["Mark done"]);
    await click(button("Mark done"));
    await click(button("Yes, mark done"));
    expect(rows()).toHaveLength(0);
    expect(host!.querySelector(".payments-notice")?.textContent).toBe("Marked the payment done.");
  });

  it("offers only Mark done after HintWise turns the grant down, until the list is refreshed", async () => {
    const why = "HintWise turned the grant down: it does not take kai@example.com with 50 credits. No credits were added. The payment is still open. Add them by hand (Admin: add credits), then Mark done.";
    const { deps } = server(
      [{ status: 200, body: { payments: [owed("txn_1")] } }, { status: 200, body: { payments: [owed("txn_1")] } }],
      { "/api/admin/payments/txn_1/grant": [{ status: 502, body: { error: { code: "grant_refused", message: why } } }] },
    );
    await render(deps);
    await click(button("Grant and mark done"));
    expect(rows()[0].querySelector('[role="alert"]')?.textContent).toBe(why);
    expect(buttons(rows()[0]).map((x) => x.textContent)).toEqual(["Mark done"]);
    await click(button("Refresh"));
    expect(rows()[0].querySelector('[role="alert"]')).toBeNull();
    expect(buttons(rows()[0]).map((x) => x.textContent)).toEqual(["Grant and mark done", "Mark done"]);
  });

  it("offers only Mark done whenever it is not known whether the credits went in, also after a refresh", async () => {
    const cases: [string, Reply, RegExp][] = [
      ["grant_unclear", { status: 502, body: { error: { code: "grant_unclear", message: "HintWise did not confirm the grant (HTTP 504), so the credits may or may not have been added. Do not grant this payment again." } } }, /did not confirm the grant/],
      ["grant_unreachable", { status: 502, body: { error: { code: "grant_unreachable", message: "The connection to HintWise failed while the grant was being sent, so the credits may or may not have been added." } } }, /connection to HintWise failed/],
      ["Netlify's 504", { status: 504, body: "" }, /did not say whether the credits were added \(HTTP 504\)/],
      ["a lost connection", "offline", /not known whether the grant reached it/],
      ["no etag", { status: 503, body: { error: { code: "unguarded", message: "The payment store gave this payment no version to write against." } } }, /no version/],
      ["busy", { status: 409, body: { error: { code: "busy", message: "This payment is being granted right now." } } }, /being granted right now/],
    ];
    for (const [name, reply, why] of cases) {
      const claimed = owed("txn_1", { grantStartedAt: "2026-11-28T18:00:00.000Z" });
      const { deps } = server([{ status: 200, body: { payments: [owed("txn_1")] } }, { status: 200, body: { payments: [claimed] } }], { "/api/admin/payments/txn_1/grant": [reply] });
      await render(deps);
      await click(button("Grant and mark done"));
      expect(rows()[0].querySelector('[role="alert"]')?.textContent, name).toMatch(why);
      expect(rows()[0].textContent).not.toMatch(/were not added/);
      expect(buttons(rows()[0]).map((x) => x.textContent), name).toEqual(["Mark done"]);
      expect(document.activeElement?.textContent).toBe("Mark done");
      await click(button("Refresh"));
      expect(rows()[0].textContent).toMatch(/did not confirm, so the credits may or may not have been added/);
      expect(buttons(rows()[0]).map((x) => x.textContent), name).toEqual(["Mark done"]);
      act(() => root?.unmount());
      host?.remove();
      root = null;
      host = null;
    }
  });

  it("warns, and does not just say done, when someone else marked the payment while the grant ran", async () => {
    const onGranted = vi.fn();
    const { deps } = server(
      { status: 200, body: { payments: [owed("txn_1")] } },
      { "/api/admin/payments/txn_1/grant": [{ status: 200, body: { email: "kai@example.com", balance: 100, credits: 50, already: false, markedMeanwhile: true, grantedAt: "2026-11-28T18:00:05.000Z" } }] },
    );
    await render(deps, onGranted);
    await click(button("Grant and mark done"));
    const notice = host!.querySelector(".payments-notice")!;
    expect(notice.textContent).toMatch(/^Added 50 credits to kai@example\.com \(balance now 100\), but someone else marked the payment done while the grant was running/);
    expect(notice.className).toContain("warn");
    expect(document.activeElement).toBe(notice);
    expect(rows()).toHaveLength(0);
    expect(onGranted).toHaveBeenCalledTimes(1);
  });

  it("does nothing on a second click while the first is under way", async () => {
    let answer: (v: { status: number; body: unknown }) => void = () => undefined;
    const { deps, calls } = server({ status: 200, body: { payments: [owed("txn_1")] } }, { "/api/admin/payments/txn_1/grant": [new Promise((r) => (answer = r))] });
    await render(deps);
    const grant = button("Grant and mark done");
    await click(grant);
    expect(grant.textContent).toBe("Granting…");
    expect(grant.getAttribute("aria-disabled")).toBe("true");
    expect(rows()[0].getAttribute("aria-busy")).toBe("true");
    await click(grant);
    await click(button("Mark done"));
    expect(text()).not.toContain("Yes, mark done");
    expect(calls.filter((c) => c.startsWith("POST"))).toEqual(["POST /api/admin/payments/txn_1/grant"]);
    await act(async () => answer({ status: 200, body: { email: "kai@example.com", balance: 50, credits: 50 } }));
    await settle();
    expect(rows()).toHaveLength(0);
  });

  it("shows a grant that never finished, and offers only Mark done", async () => {
    const { deps } = server({ status: 200, body: { payments: [owed("txn_1", { grantStartedAt: "2026-11-28T11:00:00.000Z" })] } });
    await render(deps);
    expect(rows()[0].textContent).toMatch(/began \(.+\) and did not confirm, so the credits may or may not have been added\. Do not grant it again: check the account's balance/);
    expect(buttons(rows()[0]).map((x) => x.textContent)).toEqual(["Mark done"]);
  });
});

describe("what was paid", () => {
  it("marks a payment under the list price, and asks before granting it, naming the amount", async () => {
    const onGranted = vi.fn();
    const { deps, calls } = server(
      { status: 200, body: { payments: [owed("txn_free", { total: "0" }), owed("txn_full", { total: "1100" })] } },
      { "/api/admin/payments/txn_free/grant": [{ status: 200, body: { email: "kai@example.com", balance: 50, credits: 50, already: false, grantedAt: "x" } }] },
    );
    await render(deps, onGranted);
    const [free, full] = rows();
    expect(free.querySelector(".payment-flag")?.textContent).toBe("Paid less than the list price");
    expect(free.textContent).toContain("PaidUS$0.00");
    expect(free.querySelector(".payment-warn")?.textContent).toBe("Paid US$0.00, less than the pack's list price of US$10 (a discount, or a test). Check the sale in Paddle before granting the whole pack.");
    expect(full.querySelector(".payment-flag")).toBeNull();
    expect(full.querySelector(".payment-warn")).toBeNull();

    const grant = button("Grant and mark done", free);
    await click(grant);
    expect(calls.filter((c) => c.startsWith("POST"))).toEqual([]);
    const group = rows()[0].querySelector('[role="group"]')!;
    expect(group.getAttribute("aria-label")).toBe("Confirm Grant and mark done");
    expect(group.textContent).toContain("Grant 50 credits for a payment of US$0.00 (the pack's list price is US$10)?");
    expect(document.activeElement?.textContent).toBe("Yes, grant and mark done");
    await press("Escape");
    expect(document.activeElement?.textContent).toBe("Grant and mark done");
    expect(document.activeElement).toBe(button("Grant and mark done", rows()[0]));
    await click(button("Grant and mark done", rows()[0]));
    await click(button("Cancel", rows()[0]));
    expect(document.activeElement).toBe(button("Grant and mark done", rows()[0]));
    expect(calls.filter((c) => c.startsWith("POST"))).toEqual([]);

    await click(button("Grant and mark done", rows()[0]));
    await click(button("Yes, grant and mark done"));
    expect(calls.filter((c) => c.startsWith("POST"))).toEqual(["POST /api/admin/payments/txn_free/grant"]);
    expect(rows()).toHaveLength(1);
    expect(onGranted).toHaveBeenCalledTimes(1);
  });

  it("says when the amount was not recorded, or cannot be compared, and asks before granting", async () => {
    const { deps } = server({ status: 200, body: { payments: [owed("txn_old", { total: null, currency: null }), owed("txn_eur", { total: "920", currency: "EUR" })] } });
    await render(deps);
    const [old, eur] = rows();
    expect(old.textContent).toContain("PaidAmount not recorded");
    expect(old.querySelector(".payment-warn")?.textContent).toBe("The amount paid was not recorded for this payment. Check it in Paddle before granting.");
    expect(eur.textContent).toContain("Paid9.20 EUR");
    expect(eur.querySelector(".payment-warn")?.textContent).toMatch(/^Paid in EUR, which cannot be compared with the pack's list price of US\$10 here/);
    expect(old.querySelector(".payment-flag")).toBeNull();
    await click(button("Grant and mark done", old));
    expect(rows()[0].querySelector('[role="group"]')?.textContent).toContain("Grant 50 credits for a payment whose amount was not recorded (the pack's list price is US$10)?");
    await press("Escape");
    await click(button("Grant and mark done", rows()[1]));
    expect(rows()[1].querySelector('[role="group"]')?.textContent).toContain("Grant 50 credits for a payment of 9.20 EUR (the pack's list price is US$10)?");
  });

  it("does not warn about the amount on a row that cannot be granted from here", async () => {
    const { deps } = server({ status: 200, body: { payments: [owed("txn_1", { pack: null, credits: null, total: "0" })] } });
    await render(deps);
    expect(rows()[0].querySelector(".payment-warn")).toBeNull();
    expect(rows()[0].querySelector(".payment-flag")?.textContent).toBe("Paid less than the list price");
  });
});

describe("Mark done", () => {
  it("asks first, with focus on the confirmation; Escape cancels and gives focus back", async () => {
    const { deps, calls } = server({ status: 200, body: { payments: [owed("txn_1", { pack: null, credits: null })] } });
    await render(deps);
    await click(button("Mark done"));
    expect(text()).toContain("Mark this payment done without adding credits here?");
    expect(document.activeElement?.textContent).toBe("Yes, mark done");
    await press("Escape");
    expect(text()).not.toContain("without adding credits here?");
    expect(document.activeElement?.textContent).toBe("Mark done");
    await click(button("Mark done"));
    await click(button("Cancel"));
    expect(document.activeElement?.textContent).toBe("Mark done");
    expect(calls.filter((c) => c.startsWith("POST"))).toEqual([]);
  });

  it("marks once confirmed, without granting", async () => {
    const onGranted = vi.fn();
    const { deps, calls } = server(
      { status: 200, body: { payments: [owed("txn_1", { pack: null, credits: null })] } },
      { "/api/admin/payments/txn_1/granted": [{ status: 200, body: { grantedAt: "x", already: false } }] },
    );
    await render(deps, onGranted);
    await click(button("Mark done"));
    await click(button("Yes, mark done"));
    expect(calls.filter((c) => c.startsWith("POST"))).toEqual(["POST /api/admin/payments/txn_1/granted"]);
    expect(rows()).toHaveLength(0);
    expect(text()).toContain("No payments are waiting");
    expect(host!.querySelector(".payments-notice")?.textContent).toBe("Marked the payment done.");
    expect(onGranted).not.toHaveBeenCalled();
  });

  it("says so when a grant is under way, and offers only Mark done", async () => {
    const why = "A grant of this payment started at 28 Nov 2026, 18:00 UTC and may still be running, so it cannot be marked done before 28 Nov 2026, 18:02 UTC.";
    const { deps } = server({ status: 200, body: { payments: [owed("txn_1")] } }, { "/api/admin/payments/txn_1/granted": [{ status: 409, body: { error: { code: "grant_running", message: why } } }] });
    await render(deps);
    await click(button("Mark done"));
    await click(button("Yes, mark done"));
    expect(rows()[0].querySelector('[role="alert"]')?.textContent).toBe(why);
    expect(buttons(rows()[0]).map((x) => x.textContent)).toEqual(["Mark done"]);
  });

  it("says why when the mark fails, and keeps the payment", async () => {
    const { deps } = server(
      { status: 200, body: { payments: [owed("txn_1")] } },
      { "/api/admin/payments/txn_1/granted": [{ status: 503, body: { error: { code: "not_marked", message: "The payment could not be marked done. It is still open; try again." } } }] },
    );
    await render(deps);
    await click(button("Mark done"));
    await click(button("Yes, mark done"));
    expect(rows()).toHaveLength(1);
    expect(rows()[0].querySelector('[role="alert"]')?.textContent).toMatch(/still open; try again/);
    expect(document.activeElement?.textContent).toBe("Mark done");
  });
});

describe("Refresh", () => {
  it("loads the list again and clears the last message", async () => {
    const { deps, calls } = server(
      [{ status: 200, body: { payments: [owed("txn_1")] } }, { status: 200, body: { payments: [] } }, { status: 200, body: { payments: [owed("txn_2")] } }],
      { "/api/admin/payments/txn_1/granted": [{ status: 200, body: { grantedAt: "x", already: true } }] },
    );
    await render(deps);
    await click(button("Mark done"));
    await click(button("Yes, mark done"));
    expect(host!.querySelector(".payments-notice")?.textContent).toBe("That payment was already marked done.");
    await click(button("Refresh"));
    expect(host!.querySelector(".payments-notice")?.textContent).toBe("");
    expect(text()).toContain("No payments are waiting");
    await click(button("Refresh"));
    expect(rows()[0].textContent).toContain("txn_2");
    expect(calls.filter((c) => c === "GET /api/admin/payments")).toHaveLength(3);
  });
});
