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

In progress: nothing.

Remaining
- [ ] Both Paddle MCPs answer (in the last session `paddle-sandbox` refused every call; `paddle-live` was not loaded).
- [ ] Migration audit, read-only, sandbox vs live: products, prices, discounts, client tokens, notification destinations, payment methods, tax, balance currency, checkout domains, default payment link, verifications. Report done vs missing.
- [ ] Create in live only what is missing: the two pack products/prices, a `live_` client token, and a notification destination only if none exists for `https://photo2pgn.hintwise.org/api/paddle-webhook` with `transaction.completed`. Record the sandbox → live id map.
- [ ] Ask the owner which payment methods to enable, and before mirroring tax mode or balance currency.
- [ ] Owner, in the dashboard: Website approval for photo2pgn.hintwise.org, bank details, verification.
- [ ] Netlify: set `VITE_PADDLE_CLIENT_TOKEN`, `VITE_PADDLE_PRICE_PACK_20`, `VITE_PADDLE_PRICE_PACK_50`; fix `PGN_PADDLE_PRICE_PACK_20/_50` (now `500`/`1000`, must be the live `pri_` ids; same in local `.env`); set `PGN_PADDLE_WEBHOOK_SECRET` to the live destination's secret if it differs.
- [ ] Merge this branch to `main` and push: the one production deploy the owner approved. Check the live bundle has the `live_` token, and that non-admins still see "Coming soon".
- [ ] Default payment link once the domain is approved (see Open questions 5).
- [ ] Live test, after verification and approval: 100% discount limited to the two pack prices, usage limit 1, expiring in 24 h; the owner buys one pack, signed in, at `/pricing` (never pay for them); verify; owner grants; mark granted; archive the discount.
- [ ] Owner decides on `VITE_PADDLE_OPEN=yes` (another deploy). Then delete this file and the memory note.

## 3. Current state

- Branch `feat/paddle-mode-from-token`, 4 code commits on `main` (`8620ef5`) plus this handoff commit; pushed with `[skip netlify]`, no PR. `main` is untouched.
- `npm run check`: exit 0, 319 tests. `npm run e2e`: 29 passed. Both on the tree of `b6ad386`.
- Written 2026-11-15 15:12 WET (this machine's clock; the owner's local time may differ).

## 4. Next step

Run a read-only `client.products.list()` through `paddle-sandbox` and through `paddle-live`. If either is
refused or missing, stop and ask the owner to re-authenticate it (`/mcp`) or grant permissions under
Connectors > MCPs in that Paddle account.

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

## 7. Constraints and gotchas

- Names only, never print values (compare by sha256 prefix): `VITE_PADDLE_CLIENT_TOKEN`, `VITE_PADDLE_PRICE_PACK_20`, `VITE_PADDLE_PRICE_PACK_50`, `VITE_PADDLE_ENV` (optional), `VITE_PADDLE_OPEN`, `PGN_PADDLE_WEBHOOK_SECRET`, `PGN_PADDLE_PRICE_PACK_20`, `PGN_PADDLE_PRICE_PACK_50`, `PGN_WORKER_TOKEN`. Local `.env` only: `PADDLE_API_KEY` (live), `PADDLE_SANDBOX_API_KEY`, `PGN_PADDLE_WEBHOOK_SECRET_EMAIL`, `PGN_PADDLE_WEBHOOK_SECRET_WEBHOOK`.
- `VITE_*` are inlined at build time: a change on Netlify needs a rebuild.
- Netlify CLI is not linked here. Use `netlify api getEnvVars|createEnvVars|updateEnvVar|deleteEnvVar --data '{"account_id":"69c41aa2ff5d6300c8880fd6","site_id":"8451b25c-7138-46ec-a630-d1e0ba157bd4",...}'`. Production secret values come back masked.
- Paddle guardrails (live is additive only; sandbox is read-only; leave-and-ask) are in the docs file. Archiving the test discount is the one exception, and the test prompt asks for it.
- Owner's global rules: an explicit yes before writing production data (live Paddle writes count), deploying (one deploy approved), spending money, or deleting what can't be restored. Questions numbered; no blocking dialogs.
- Project rules ([CLAUDE.md](CLAUDE.md)): no Anthropic key anywhere; `[skip netlify]` in docs-only commits; tests never touch the network.
- `.env.asc` (encrypted `.env`) is one change behind; the owner re-encrypts it.
- Once deployed, probing the webhook from a laptop gets 403 (IP allowlist), not 401.
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
3. Is the production webhook secret the live destination's or the sandbox one's? I don't know.
4. What already exists in live (products, prices, client token, destination)? I don't know.
5. Default payment link: Paddle appends `?_ptxn=` and expects Paddle.js on that page to open the checkout. The app loads Paddle.js only when someone presses Buy and ignores `_ptxn`. Uncertain whether an overlay-only integration needs this handled.
6. Does a $0 one-time checkout ask for a card? I don't know.
7. Why `paddle-sandbox` refused every call ("not permitted"): I don't know.
8. The owner has not confirmed the defaults taken in `39aa23c`, `b6ad386` and the `pwCustomer` skip; each can be undone with `git revert`.
