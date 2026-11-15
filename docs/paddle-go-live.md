# Paddle go-live: Paddle's own instructions

Pasted by the owner on 2026-11-15 from Paddle's onboarding
(https://vendors.paddle.com/onboarding/get-started), verbatim. Paddle's order:
(1) migrate sandbox to live, (2) "Verify your account" (owner, dashboard; not
pasted), (3) "Test and go live". photo2pgn sells one-time credit packs, so the
subscription parts do not apply; see HANDOFF.md for how each step maps here.

## 1. Migrate sandbox to live

Migrate my tested sandbox integration into my live Paddle account and finish configuring live so it's ready for verification. I may have already done some or all of this while switching to live, so start by checking what's already in place — then only do what's missing or broken. Do this once my sandbox integration has passed testing.

Heads-up: this step gets my live account and code ready — it does NOT start verification or take a live payment. Those are the next two steps ("Verify your account", then "Test and go live"). Migrating points my code at live, but I can't take live payments until verification passes and my domains are approved, so don't open the live build to real customers yet — verify locally or in staging.

I have two MCP servers:
- `paddle-sandbox` — my sandbox account (source)
- `paddle-live` — my live account (destination)

### 1. Check what's already migrated

Before changing anything, audit the current state and report what's done vs outstanding. I may have completed some of this already — don't redo work that's correct.
- Catalog: compare my sandbox products, prices, and discounts against live (`paddle-sandbox` vs `paddle-live`). List what already exists in live and what's missing.
- Credentials: check my env vars and code for live client-side tokens (`live_`), a live API key, and live notification destinations with a signing secret.
- Code: check whether my code already points at live — live `pri_`/`pro_` IDs, `api.paddle.com`, no `Paddle.Environment.set('sandbox')`, and `pwCustomer` set for Retain.

Give me a short summary of what's already done and what's left, then work through the remaining items below. Skip anything that's already correct; if something exists but looks wrong or partial, fix it.

### 2. Recreate my catalog and credentials in live

For anything missing from the audit:
1. Read my products, prices, and discounts from sandbox and create equivalents in live with the `paddle-live` MCP. Skip test/junk items. Capture the sandbox → live ID mapping — I need it for step 3.
2. Create new live client-side tokens (prefixed `live_`) with the `paddle-live` MCP if it supports it; prompt me to create a live API key in the dashboard. Read both from env vars; never hard-code them. Create/update `.env.example`.
3. Create live notification destinations pointing at my live webhook URLs, and read back the new signing secret (`endpoint_secret_key`). Update the secret my webhook handler uses.

### 3. Swap my code over to live

For anything not already pointing at live, find and replace every sandbox value with its live equivalent:
- Every sandbox price ID (`pri_`) and discount ID → matching live IDs, across pricing page, checkout, upgrade/downgrade logic, and subscription lifecycle code.
- Remove `Paddle.Environment.set('sandbox')` from the frontend (live is the default).
- `sandbox-api.paddle.com` → `api.paddle.com` server-side.
- For Paddle Retain, add `pwCustomer` to `Paddle.Initialize()` — the signed-in customer's Paddle customer ID, e.g. `pwCustomer: { id: 'ctm_...' }`. It must be the Paddle customer ID, not my internal ID or email.

### 4. Finish configuring my live account

Do these via `paddle-live` where you can; otherwise tell me exactly where to go in the dashboard:
- Payment methods — read what's enabled in `paddle-sandbox` and `paddle-live` (`GET /settings/checkout-payment-methods`), ask me which ones I want in live, then enable them with `paddle-live` (`PATCH /settings/checkout-payment-methods`). If you can't, tell me to enable them under Checkout > Checkout settings.
- Sales tax and balance currency — live settings are separate from sandbox. Read the sales tax mode (`GET /settings/tax`) and balance currency (`GET /settings/balance-currency`) from both `paddle-sandbox` and `paddle-live`, show me any differences, and ask me before mirroring the sandbox values to live with `paddle-live` (`PATCH /settings/tax`, `PATCH /settings/balance-currency`). If you can't, tell me to set them under My account > Settings > Sales tax and My account > Settings > Currencies.
- Submit my domains for approval under My account > Settings > Website approval. This is a dashboard step — there's no API for submitting a domain, so tell me to do it. Checkout won't run on live until a domain is approved (sandbox approves automatically; live does not). Submit now so approval can process while I verify.
- Default payment link — once my domain is approved, set it to my live checkout page with `paddle-live` (`PATCH /settings/checkout-url`). Check first with `GET /checkout-domains`: for live it must be on an approved domain, not localhost, or live checkouts will fail. If my domain isn't approved yet, tell me to set it under Checkout > Checkout settings once Paddle approves it. If the call fails — it returns `forbidden` or the tool isn't available — tell me to set it there too.
- Add my bank details under Business account > Payouts > Payout settings.

Writing settings needs permissions like `checkout_settings.write`. If a call returns `forbidden`, tell me to grant the permission under Connectors > MCPs or do it in the dashboard.

For webhook security, fetch Paddle's current live IPs from https://api.paddle.com/ips (addresses are in `data.ipv4_cidrs`, as /32 CIDRs), allowlist them on my webhook server, and reject anything else. Don't hard-code the list — the endpoint is the source of truth and can change.

### 5. Pre-verification readiness check

Audit my app and report what's ready vs missing, so I'm set up to pass verification next:
- Live, publicly accessible Terms & Conditions, Privacy Policy, and Refund/Cancellation Policy. List the URLs; flag any that 404 or redirect to a generic page.
- A clear description of what my product does.
- Contact details reachable from the homepage in two clicks or fewer.
- Site pricing matches my live Paddle catalog. List discrepancies.
- Every domain where I run Checkout resolves and serves my real product (not parked, 404, or placeholder).

For each gap, suggest a specific fix. These are common verification checks — confirm exact current requirements against Paddle's verification guidance rather than treating any item as definitively required.

When this is done, my live account and code are ready. Move on to "Verify your account" to complete business verification, then "Test and go live".

### Guardrails — this is my LIVE account; destructive actions are off-limits

Live entities may already have real customers, subscriptions, and payment history attached. Migration here is ADDITIVE and CODE-SIDE only. You must NOT delete, archive, deactivate, or recreate any live entity, and must NOT offer to do so as "cleanup." Specifically:

- The live notification destination or its signing secret. Never delete or recreate one that already exists — recreating rotates endpoint_secret_key and silently breaks verification of every future delivery. If a live destination exists, reuse it; only CREATE one if none exists.
- Live products, prices, or discounts — never delete, archive, or recreate them, especially any with active subscriptions. Editing a price only changes it for new purchases; existing subscriptions keep the version they were created with. If a live price is wrong, show me the fix and ask before you edit it.
- Live customers, subscriptions, or transactions, and their mirrored DB rows — never change them.
- My sandbox account. It is the source of truth for this migration — do not delete or modify any sandbox entity, and do not offer to "clean up sandbox" when done.

"Fix if wrong or partial" (above) means: prefer update-in-place; if a genuine fix would require deleting or recreating any live entity, STOP, name the entity and the exact change, and ask me before doing anything. Default to leave-and-ask.

## 3. Test and go live

Test my Paddle integration end-to-end in live, with a real checkout, before I open to customers.

This mirrors the sandbox test but against real money — so we'll use a 100% discount to run a genuine checkout at zero cost, then clean it up. Use the `paddle-live` MCP to perform and verify every action against my live account. To check database state, use a database MCP if I have one connected (e.g. Supabase, or another Postgres/database MCP); otherwise verify through my app's data layer or tell me exactly what to confirm. Where you can't act via MCP, tell me what to do in the dashboard.

### 1. Pre-flight checks

Confirm all of these before testing — stop and fix anything that's off:
- My integration points at live everywhere: live API key, `live_`-prefixed client-side token, live `pri_`/`pro_` IDs, server-side calls to `api.paddle.com` (not `sandbox-api.paddle.com`), and no leftover `Paddle.Environment.set('sandbox')`.
- My domain is approved. List my checkout domains with the `paddle-live` MCP (or the Checkout Domains API: https://developer.paddle.com/api-reference/checkout-domains/list-checkout-domains/) and confirm the status is approved — checkout won't open on an unapproved domain.
- Business and identity verification is complete. Check with the `paddle-live` MCP (`GET /verifications?verification_type=onboarding`): my account is verified when the onboarding verification's `status` is `completed`. If it's anything else, tell me what's outstanding and to finish it in the dashboard. If there's no onboarding verification, or you can't check, ask me to confirm in the dashboard before continuing. Verification is usually ~10 minutes but can take longer for more complex businesses. Checkout won't open until it's passed.
- My app is deployed to the live domain. Ask me to confirm; checkout must run on the real approved domain, not localhost.

### 2. Set up a safe, zero-cost test

Create a 100% off discount with the `paddle-live` MCP and give me the code to apply at checkout. Tell me you're doing this and why: it lets us run a real end-to-end checkout — real card, real webhooks, real records — at zero cost, so there's nothing to refund afterwards. Paddle still creates a real transaction and subscription at a $0 total, so the rest of the test exercises the full flow.

### 3. Hand over to me to complete the checkout

Pause here and ask me to complete one real purchase myself — don't open a browser or try to pay on my behalf:
- Open checkout on my live domain, apply the discount code from step 2, and complete the purchase with a real card.
- When I confirm it's done, continue. If I hit any problems — checkout doesn't load, the discount doesn't apply, the price looks wrong — I'll tell you and we'll work through them together.

### 4. Verify the result

Once I've confirmed the purchase, verify each step as in the sandbox test:
- Transaction status is `completed`.
- My live webhook endpoint received the events and returned 2xx (check the `paddle-live` MCP or Events > Notifications).
- Customer and subscription records were created/updated in my database.
- The access helper would unlock the right features for the plan.

### 5. Exercise the subscription lifecycle

Find the completed transaction and the subscription it created, then run the same three operations as the sandbox test with the `paddle-live` MCP. After each, confirm my handler processed the webhook and my database/access logic ended up correct:
- (a) Plan upgrade applied immediately with no charge (proration billing mode `do_not_bill`).
- (b) Scheduled cancellation at end of billing period (`effective_from: next_billing_period`) — status should still be `active` (or `trialing`, if the plan has a trial) with a pending scheduled change, and access still granted.
- (c) Immediate cancellation (`effective_from: immediately`) — status `canceled`, access denied.

### 6. Clean up — this is real data, leave nothing live

- Make sure the test subscription is canceled.
- Archive the 100% discount with the `paddle-live` MCP so nobody else can use it.

Confirm everything above passed before I open to customers. If anything fails at any step, stop, troubleshoot it the same way, and re-run.

If a 100% discount isn't workable for my setup, the alternative is to pay with a real card and refund it by creating an adjustment with the `paddle-live` MCP. Avoid this if you can — refunds hurt my seller reputation and can raise my chargeback rate. Talk me through other options first, and only take the refund path if I explicitly choose it.
