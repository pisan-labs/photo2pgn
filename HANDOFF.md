# Handoff: Paddle go-live for photo2pgn

## 1. Goal

Owner, 15 Nov: "Last steps on testing the live site connection to paddle.com." Then Paddle's own
onboarding prompts, pasted verbatim into [docs/paddle-go-live.md](docs/paddle-go-live.md): (1) migrate
the sandbox integration to live and get it ready for verification, (2) verify the account (owner,
dashboard), (3) "Test my Paddle integration end-to-end in live, with a real checkout, before I open
to customers" using a 100% discount. Read that file; do not work from a paraphrase.

How it maps here: photo2pgn sells one-time credit packs (`pack-20` 20 credits US$5, `pack-50`
50 credits US$10, [src/lib/credits.ts](src/lib/credits.ts)); no subscriptions. So skip the test's
step 5 (subscription lifecycle) and Retain `pwCustomer`. "Database" = the Netlify Blobs `payments`
store, read with `GET /api/worker/payments`; "access" = the owner adds credits by hand (Admin: add
credits), then `POST /api/worker/payments/:id/granted`.

Done means: live catalog has both packs; the live build uses a `live_` token and live `pri_` ids;
the live webhook secret is on Netlify; domain approved and account verified; one real $0 checkout on
photo2pgn.hintwise.org completes, the webhook answers 2xx and the payment record has the right pack,
credits and `user_id`; the discount is archived. Only then does the owner open sales.

## 2. Status

Done
- [x] Netlify: `PGN_PADDLE_ENV` and `PGN_PADDLE_API_KEY` (the sandbox key; nothing read either) deleted, kept as comments at the end of local `.env` (owner: "comment them out").
- [x] `80b37c7` the client token prefix picks live (`live_`) or sandbox (`test_`); a mismatching `VITE_PADDLE_ENV` or a non-`pri_` price sells nothing, admins see why.
- [x] `dd842f0` webhook accepts only Paddle's IPs from `https://api.paddle.com/ips`; `.env.example` lists the Paddle settings.
- [x] `39aa23c` only admins can buy until `VITE_PADDLE_OPEN=yes` (default taken, owner did not answer).
- [x] `b6ad386` Contact link in the app footer (default taken).
- [x] Readiness: `/terms`, `/refunds`, `/privacy`, `/pricing` all 200 with their own titles; description present; domain serves the app.
- [x] The production `PGN_PADDLE_WEBHOOK_SECRET` equals local `.env` `PGN_PADDLE_WEBHOOK_SECRET_WEBHOOK` (a signed, ignored event got 200).

- [x] 2026-11-15 (session 2): handoff verified against the repo: clean tree, branch in sync with origin, `npm run check` exit 0, `main` still `8620ef5`. `paddle-live` answers: `products.list()` returns 0 products (live catalog empty, so the packs must be created). `paddle-sandbox` still refuses: "You aren't permitted to perform this request" (credentials rejected, not the network).

- [x] Live audit, read-only (2026-11-15, session 2): 0 products, 0 prices, 0 discounts, 0 client tokens. Destinations: `ntfset_01m7f79d55aaznd89x3smbdrhb` ("Notice hook", `https://photo2pgn.hintwise.org/api/paddle-webhook`, `transaction.completed`, active) and `ntfset_01m7at507z10c7dakew982z4qp` (email to support, many events); reuse both, create none. Domain `photo2pgn.hintwise.org` approved (`chedom_01m7fd9nwwvct819kjsdr81cxj`, Apple Pay verified). Onboarding verification `completed` (account_setup, automated_review). Payment methods enabled: apple_pay, bancontact, card, paypal. Tax `location`; balance currency USD. Default payment link: `null`. Not yet compared: the secret of the "Notice hook" destination vs production.

- [x] Sandbox read via curl with `PADDLE_SANDBOX_API_KEY` (owner yes; the MCP still refuses). Sandbox packs to copy: product "Photo to PGN credits" (`pro_01m7ar3rnjcff45z5929dyqzyj`, saas, custom_data app=photo2pgn); prices `pri_01m7ar3rtacs2n7f8sbvgzaptr` (20 credits, 500 USD) and `pri_01m7ar3rz6dtyarh4mt9k7b290` (50 credits, 1000 USD), both `tax_mode: external`, quantity 1..1, custom_data `{app, credits}`. Other sandbox products (Starter/Pro/Advanced) are not photo2pgn: skip. No sandbox discounts. Sandbox tax `location`, balance USD, same as live: nothing to mirror. Sandbox destination points at `/api/paddle/webhook` (different path from live's).
- [x] Owner decisions: live payment methods = credit cards and PayPal; default payment link stays unset; compare webhook secrets.
- [x] Secret check by sha256 prefix: live "Notice hook" secret `0e5c41d3`; local `.env` `PGN_PADDLE_WEBHOOK_SECRET_WEBHOOK` (what production holds) `dff2e225`. They DIFFER: production would reject real live deliveries (401) until `PGN_PADDLE_WEBHOOK_SECRET` is set to the live destination's secret.
- [x] `paddle-live` MCP lacks `product.write`: `products.create` refused ("not authorized to create|read product"). Nothing was created in live.

- [x] Owner (later): `.env` secret "is the one from notifications-v2"; Apple Pay stays on (so live = card, PayPal, Apple Pay; Bancontact off); set the secret on Netlify myself; create packs + token once writes work.
- [x] Root cause of the secret mismatch: local `PGN_PADDLE_WEBHOOK_SECRET` is 33 chars with no `pdl_ntfset_` prefix; it matches neither the live destination's secret (70 chars, `pdl_ntfset_01m7f79d…`, sha8 `0e5c41d3`), its last 32/33 chars, nor the sandbox destination's (sha8 `d40dfdf3`). Where it came from: I don't know. Paddle signs with `endpoint_secret_key`, so that is what the handler needs.
- [x] Netlify `PGN_PADDLE_WEBHOOK_SECRET` (production context) set to the live destination's secret via `setEnvVarValue` (exit 0). Other contexts keep the old value. Functions read it only after the next deploy; not verified yet (masked; a laptop probe hits the old build). Local `.env` updated the same way, old line kept as a comment. `.env.asc` is now two changes behind.
- [x] `checkout_settings.write` also missing: turning Bancontact off was refused. Nothing changed in live.

- [x] Owner granted `paddle-live` write permissions. Created in live (sandbox → live):
  - product `pro_01m7ar3rnjcff45z5929dyqzyj` → `pro_01m7fxjxrn0gx7mwcknyxmjx3a` ("Photo to PGN credits")
  - pack-20 `pri_01m7ar3rtacs2n7f8sbvgzaptr` → `pri_01m7fxjy6js4cmtqn4qww0xd04` (500 USD)
  - pack-50 `pri_01m7ar3rz6dtyarh4mt9k7b290` → `pri_01m7fxjybjk7ey03p99tegkz4n` (1000 USD)
  - client token `ctkn_01m7fxk1yhmrz290ksjz60hfm9` ("photo2pgn pricing page (live)", `live_0879…`)
  - Bancontact off; live payment methods now apple_pay, card, paypal.
- [x] Netlify: created `VITE_PADDLE_CLIENT_TOKEN`, `VITE_PADDLE_PRICE_PACK_20`, `VITE_PADDLE_PRICE_PACK_50` (builds scope, all contexts); `PGN_PADDLE_PRICE_PACK_20/_50` now the live `pri_` ids (`setEnvVarValue` on context `all` failed, `updateEnvVar` worked). Local `.env`: same price ids; the `VITE_*` values only as comments, because Vite and vitest load `VITE_*` from `.env` and a live token must not run on localhost.

- [x] Owner yes to the merge + deploy and to the live-test discount. Merged with `--no-ff` as `9fb39e5` and pushed. Netlify did not build it: the merge message's body quoted the literal skip token (my mistake; Netlify skips a push whose head commit message contains it, even in the body). Started the build through the API instead (`createSiteBuild`, deploy `6af9daf3965159019b9702a5`, 16:16 WET), no extra commit.
- [x] Live checkout features: `discounts_enabled: true` (the code field shows at checkout).

- [x] Deploy `6af9daf3965159019b9702a5` ready on `9fb39e5`. Live bundle `index-D0JMsbSH.js` has the `live_0879…` token and both live `pri_` ids; signed-out `/pricing` shows two "Coming soon" buttons (headless Chromium); webhook POST from a laptop gets 403 (IP allowlist working).
- [x] Test discount `dsc_01m7g01p6a0615x8keasjjtxsy`, code `PGNTEST5ZE2BP`: 100%, usage limit 1, only the two live pack prices, expires 2026-11-16T16:18:34Z. Archive it after the test.

- [x] First Buy failed: Paddle overlay "Something went wrong"; console `transaction_default_checkout_url_not_set` (POST checkout-service.paddle.com/transaction-checkout 400). Root cause: live default payment link was null (owner had said leave it unset; sandbox had `https://photo2pgn.hintwise.org/pricing`). Owner yes: live `default_url` set to `https://photo2pgn.hintwise.org/pricing`. Open question 5 answered: Paddle.js checkouts need a default payment link even for overlay-only use.

- [x] Live test passed (2026-11-15 16:25 UTC). Owner bought pack-50 with the code ("Add discount" sits in the overlay's order summary). Transaction `txn_01m7g0dhqzapvptp466wdykzkr` `completed`, origin web, subtotal 1000, discount 1000, tax 0, total 0 USD, customer `ctm_01m7g0989bbcxa3hcv2drdctdd`, custom_data pack-50 / 50 credits / user_id `e3a587c4-…`. Notice hook delivery `ntf_01m7g0eavgj06mckjcrgvcvbh0`: first attempt, HTTP 200 `{"recorded":true}` (so the IP allowlist and the new live secret both work). `GET /api/worker/payments`: one record, pack-50, 50 credits, right user_id, `grantedAt: null`.
- [x] Discount archived (times_used 1).
- Left alone (guardrail: never change live transactions): 3 `draft` and 1 `ready` transactions from the failed first attempts.

In progress: owner adds 50 credits (Admin: add credits) to their account; then `POST /api/worker/payments/txn_01m7g0dhqzapvptp466wdykzkr/granted`.

Remaining
- [ ] `paddle-sandbox` MCP still refuses (curl works); not needed any more.
- [ ] Owner: grant `paddle-live` write permissions (product, price, client token, checkout settings) at https://vendors.paddle.com/mcps.
- [ ] Migration audit, read-only, sandbox vs live: products, prices, discounts, client tokens, notification destinations, payment methods, tax, balance currency, checkout domains, default payment link, verifications. Report done vs missing.
- [ ] Create in live only what is missing: the two pack products/prices, a `live_` client token, and a notification destination only if none exists for `https://photo2pgn.hintwise.org/api/paddle-webhook` with `transaction.completed`. Record the sandbox → live id map.
- [ ] Ask the owner which payment methods to enable, and before mirroring tax mode or balance currency.
- [ ] Owner, in the dashboard: Website approval for photo2pgn.hintwise.org, bank details, verification.
- [ ] Netlify: set `VITE_PADDLE_CLIENT_TOKEN`, `VITE_PADDLE_PRICE_PACK_20`, `VITE_PADDLE_PRICE_PACK_50`; fix `PGN_PADDLE_PRICE_PACK_20/_50` (now `500`/`1000`, must be the live `pri_` ids; same in local `.env`); set `PGN_PADDLE_WEBHOOK_SECRET` to the live destination's secret if it differs.
- [ ] Merge this branch to `main` and push: the one production deploy the owner approved. Check the live bundle has the `live_` token, and that non-admins still see "Coming soon".
- [x] Default payment link: set to `/pricing` (required; see Status).
- [ ] Live test, after verification and approval: 100% discount limited to the two pack prices, usage limit 1, expiring in 24 h; the owner buys one pack, signed in, at `/pricing` (never pay for them); verify; owner grants; mark granted; archive the discount.
- [ ] Owner decides on `VITE_PADDLE_OPEN=yes` (another deploy). Then delete this file and the memory note.

## 3. Current state

- Branch `feat/paddle-mode-from-token`, 4 code commits on `main` (`8620ef5`) plus this handoff commit; pushed with `[skip netlify]`, no PR. `main` is untouched.
- `npm run check`: exit 0, 319 tests. `npm run e2e`: 29 passed. Both on the tree of `b6ad386`.
- Written 2026-11-15 15:12 WET (this machine's clock; the owner's local time may differ).

## 4. Next step

With the owner's go: `npm run check` and `npm run e2e`, merge `feat/paddle-mode-from-token` into `main`, push
(the production deploy). Then check the live bundle has `live_0879…` and both live `pri_` ids, and that a
signed-out visitor sees "Coming soon". Then the live test (100% discount, owner buys at `/pricing`).

## 5. Decisions and why

- Live checks go through the `paddle-live` MCP (owner picked it over curl with the live key in `.env`). Never use `paddle-sandbox` for live.
- The token prefix decides live vs sandbox (owner yes), so the two cannot disagree. `Paddle.Environment.set` is called only for sandbox, because live is the default.
- Only admins can buy until `VITE_PADDLE_OPEN=yes`. Paddle says no live customers before verification, but the test must run on the real domain.
- IP allowlist uses the live list only, kept 1 h in a warm instance. If the list can't be had: 503 (Paddle retries). Any other sender: 403 before the body is read. Sandbox deliveries to production are now refused, on purpose.
- No Paddle API key on the server, since the app never calls Paddle's API. The webhook only records; credits are granted by hand (owner, 13 Nov).
- One production deploy for the live settings and this branch together; each push to `main` costs Netlify credits.
- `pwCustomer` skipped: no subscriptions, and no Paddle customer id per user before a purchase (default taken).

## 6. Tried and rejected

- curl to `api.paddle.com` with `.env`'s `pdl_live_` key in place of the MCP: offered, owner chose the MCP.
- "Commenting out" Netlify variables: Netlify has no comments, so they were deleted and kept as comments in local `.env`.
- Pushing the branch before the live ids exist: held, so code and settings ship in one build.
- Copying `.env`'s `PGN_PADDLE_WEBHOOK_SECRET` to production (owner believed it was the live one): it was already there, and it is not the live destination's `endpoint_secret_key`. Used the API's value instead.
- Reading the live secret with curl and the live API key, to keep it out of the transcript: the owner prefers the MCP, so it went through `paddle-live`.

## 7. Constraints and gotchas

- Names only, never print values (compare by sha256 prefix): `VITE_PADDLE_CLIENT_TOKEN`, `VITE_PADDLE_PRICE_PACK_20`, `VITE_PADDLE_PRICE_PACK_50`, `VITE_PADDLE_ENV` (optional), `VITE_PADDLE_OPEN`, `PGN_PADDLE_WEBHOOK_SECRET`, `PGN_PADDLE_PRICE_PACK_20`, `PGN_PADDLE_PRICE_PACK_50`, `PGN_WORKER_TOKEN`. Local `.env` only: `PADDLE_API_KEY` (live), `PADDLE_SANDBOX_API_KEY`, `PGN_PADDLE_WEBHOOK_SECRET_EMAIL`, `PGN_PADDLE_WEBHOOK_SECRET_WEBHOOK`.
- `VITE_*` are inlined at build time: a change on Netlify needs a rebuild.
- Netlify CLI is not linked here. Use `netlify api getEnvVars|createEnvVars|updateEnvVar|deleteEnvVar --data '{"account_id":"69c41aa2ff5d6300c8880fd6","site_id":"8451b25c-7138-46ec-a630-d1e0ba157bd4",...}'`. Production secret values come back masked.
- Paddle guardrails (live is additive only; sandbox is read-only; leave-and-ask) are in the docs file. Archiving the test discount is the one exception, and the test prompt asks for it.
- Owner's global rules: an explicit yes before writing production data (live Paddle writes count), deploying (one deploy approved), spending money, or deleting what can't be restored. Questions numbered; no blocking dialogs.
- Project rules ([CLAUDE.md](CLAUDE.md)): no Anthropic key anywhere; `[skip netlify]` in docs-only commits; tests never touch the network.
- `.env.asc` (encrypted `.env`) is one change behind; the owner re-encrypts it.
- Once deployed, probing the webhook from a laptop gets 403 (IP allowlist), not 401.
- Never write the skip token in a commit message meant to deploy, not even to explain it: Netlify matches it anywhere in the head commit's message.
- A memory note on the owner's Mac (`~/.claude/projects/-Users-pisan-bitbucket-pisanuw-photo2pgn/memory/paddle-live-test.md`) repeats this file; a cloud session will not see it.

## 8. How to run and verify

- `npm run check` (lint, typecheck, tests with 85% coverage, build); `npm run e2e` (Playwright).
- Live bundle: fetch `https://photo2pgn.hintwise.org/`, then its `/assets/index-*.js`; grep for `live_`, `pri_`, `Coming soon`.
- Owed purchases: `curl -H "Authorization: Bearer $PGN_WORKER_TOKEN" https://photo2pgn.hintwise.org/api/worker/payments`.
- Paddle's webhook IPs: `curl https://api.paddle.com/ips`.

## 9. Key files

- [docs/paddle-go-live.md](docs/paddle-go-live.md): Paddle's prompts, verbatim.
- [src/lib/checkout.ts](src/lib/checkout.ts): build settings → checkout config, environment, Paddle.js overlay.
- [src/components/BuyCredits.tsx](src/components/BuyCredits.tsx): the packs panel, admin notes, "Coming soon".
- [src/App.tsx](src/App.tsx): admin-only gate (`checkout`, `canBuy`), footer links.
- [netlify/lib/paddle.ts](netlify/lib/paddle.ts): webhook (IP allowlist, signature, record), owner's payments list.
- [netlify/functions/paddle-webhook.mts](netlify/functions/paddle-webhook.mts): thin wrapper, `context.ip`.
- [src/lib/credits.ts](src/lib/credits.ts): pack ids, credits, prices.
- [BRIEFING.md](BRIEFING.md), [CHANGES.md](CHANGES.md): project decisions and journal.

## 10. Background jobs

None running or scheduled.

## 11. Open questions

1. Which payment methods in live? (owner)
2. Do tax mode and balance currency differ between sandbox and live, and should live mirror sandbox? Not read yet.
3. Answered: it was neither; production now has the live destination's secret (takes effect at the next deploy).
4. Answered: live had only the two destinations, the approved domain and completed verification; no catalog, no token.
5. Default payment link: Paddle appends `?_ptxn=` and expects Paddle.js on that page to open the checkout. The app loads Paddle.js only when someone presses Buy and ignores `_ptxn`. Uncertain whether an overlay-only integration needs this handled.
6. Does a $0 one-time checkout ask for a card? I don't know.
7. Why `paddle-sandbox` refused every call ("not permitted"): I don't know.
8. The owner has not confirmed the defaults taken in `39aa23c`, `b6ad386` and the `pwCustomer` skip; each can be undone with `git revert`.
