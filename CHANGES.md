# Changes

2026-11-12 [scope] Photo to PGN: scoresheet photo to PGN on Netlify; owner key with per-person day/week caps and a global cap, or the visitor's own key. Sign-in and logo to come from another session.

2026-11-12 [decision] Claude call runs in a Netlify background function with jobs in Netlify Blobs, since sync functions stop at 60 s; browser polls /api/jobs/:id and resumes after reload.

2026-11-12 [decision] Claude transcribes with alternatives; a chess.js beam search decides legality and repairs. Flat stop cost so one red move beats a chain of guesses; clear legal moves stay.

2026-11-12 [decision] Settings are PGN_ prefixed and the Anthropic URL is explicit: CLAUDE_EFFORT=xhigh and ANTHROPIC_BASE_URL in the dev shell leaked into the app before the rename.

2026-11-12 [code] Vertical slice: upload, free/own-key choice, worker, review UI with board and legal-move picker, PGN export, demo game, mock Anthropic API; 70 tests; checked in netlify dev.

2026-11-12 [scope] CLI reader: free jobs can queue for cli/pgn-worker.mjs, which reads them with local Claude Code on the subscription and uploads results; optional fallback to the owner key.

2026-11-12 [decision] CLI runs claude -p --safe-mode --tools "" with photos as stream-json image blocks; strips ANTHROPIC_API_KEY/AUTH_TOKEN and stops if claude reports any API key source.

2026-11-12 [code] Worker endpoints /api/worker/jobs (list, claim with 15 min lease, result checked by zod); retry up to 3, timeout with refund. Real local read of the demo sheet: 17 moves in 19 s.

2026-11-12 [decision] Engine for awful handwriting: guesses with a natural-move prior, targeted backtracking (same piece, last 4 plies) even over clear moves, stop priced per unplayed ply, clustered fixes cost extra.

2026-11-12 [code] repair.ts rewritten: matches readings against legal SANs (no chess.js per variant), lazy positions, _ wildcards, support counts; analysis in a Web Worker; PGN move numbers from the game.

2026-11-12 [note] Platform instructions from the Plabs session: gateway for the owner key, BYOK browser-direct, Supabase sign-in, HintWise footer and favicon. Conflicts with server key, own caps and CLI photo queue sent to owner.

2026-11-12 [code] HintWise footer embedded byte for byte in index.html (sha256 test), HintWise favicon, docs renamed photo2pgn after the repo rename.

2026-11-12 [code] Shifted sheets: engine can leave a cell out or insert a missing move before it when the reading does not fit; edits "-" and "e5 Nf6"; PGN numbered by the game. Done on the 15-min default (owner unanswered).

2026-11-12 [decision] Owner yes to the platform rules: owner key only via the HintWise gateway, BYOK browser-direct, CLI reader kept for signed-in users with photos deleted once read.

2026-11-12 [code] Reading moved to the browser (template llm.ts, record_scoresheet tool); server reduced to the CLI queue with Supabase sign-in check; template sign-in and account deletion; ESLint, coverage, Playwright.

2026-11-12 [scope] Owner: integrate Notamate's features and make phone capture easy. Built: phone-first capture, turn/crop, installable app with share target, board editing, notes, exports, printable sheet, My games.

2026-11-12 [decision] Lichess export uses its public import API (imported games are public); Chess.com has no public import, so the PGN is copied and its analysis board opened. UI translation deferred.

2026-11-12 [code] Engine checked on two real sheets from the owner (transcribed): World Championship 2024 game 14 comes back exact; a club sheet with slips comes back legal with 2 entries flagged.

2026-11-12 [decision] Owner via Plabs: gateway max_tokens 8000 (BYOK keeps 16000); CLI reader on as local-then-gateway; photo2pgn caps $0.10/person/day, $0.40/week, app $1/day. Queue off or unreachable now falls back to the gateway at once.

2026-11-12 [code] local-then-gateway asks the queue only while a CLI reader is running (heartbeat, PGN_READER_IDLE_SECONDS 60); else gateway at once. netlify.app→hintwise.org 301; manifest type

2026-11-12 [note] 5 real sheets via CLI reader: Opus 5.5 exact on WCh g14 (116/116), all legal; Sonnet 5.5 73/116 there. ~90 output tok/move+~1k thinking; ≈$0.09-0.15/sheet at API prices

2026-11-12 [code] Review is an analysis board: board left, moves right, start/back/forward/end buttons and keys, move notes below; walnut squares from chess-analyzer

2026-11-12 [code] Chess TD hand-off (v1, owner chose B via Chess TD): link in with ref and pairing, game back by postMessage or URL hash; gateway max_tokens 12000 (owner via Plabs)

2026-11-12 [code] Cburnett SVG pieces (Commons, BSD-3, notice in src/assets/pieces and on the site); CLI reader effort defaults to medium (owner)

2026-11-12 [decision] Owner: Chess TD hand-off (b) confirmed; per-person caps $0.25/day, $1.00/week (app caps unchanged), sent to Plabs to apply

2026-11-12 [note] Plabs applied the caps (sql run 43297183571, 20:07 UTC): photo2pgn per person $0.25/day, $1.00/week; app $1/$5/$10; max_tokens 12000

2026-11-12 [scope] Owner: ways in are Sign in or own key (no "free account" wording, no 1-day note); photo step waits for one; out of credits offers only own key; printable sheet removed

2026-11-13 [decision] Owner: engine never stops at a misreading; best guess, then "guess" status (check it) unless the next 2 moves confirm it or it is the only legal move

2026-11-13 [code] Signed in: "Use my credits, new credits every day at <local time of 00:00 UTC>" instead of "Sign in"; "Use my own Anthropic key"; start page centred

2026-11-13 [doc] Drafts: terms, refund (14 days) and privacy pages, HintWise as seller, Paddle as Merchant of Record; packs 20/$5, 50/$10; not linked until the owner approves

2026-11-13 [code] "Use my N credits, new credits at <time>" from the gateway check mode (Plabs, live: 3 a day, 9 a week); template llm.ts recopied; legal drafts moved to legal/ (not served)

2026-11-13 [decision] Owner: legal pages approved (California law, HintWise as seller, 14-day refunds, children wording); they go live with paid credits

2026-11-13 [code] Header: no Install app or Sign in (step 1 offers sign-in); signed in: name or email (opens account panel) and Sign out; install tip moved under the intro

2026-11-13 [decision] Owner: public readings through the gateway only (VITE_FREE_READER=gateway), so every reading counts as a credit; reader exception dropped from the privacy draft

2026-11-13 [code] Credits slice 1 (Plabs live): "Use my N credits" counts free + bought; admin-only "Admin: add credits" panel (credits-grant, by email, +/-)

2026-11-13 [note] Owner checked live (979d793): "Use my 3 credits" and the admin panel shown, no errors. Next: Paddle (owner account), raise app caps before selling

2026-11-13 [code] Admin panel: "List users" (credits-grant list mode, Plabs live): email, first/last used, free left, credits, readings; Grant per row; Copy emails; privacy draft says so

2026-11-13 [code] Review: tap a piece of the side that moved to replay the move; click the selected move again for ranked alternatives; compact move panel under the buttons

2026-11-13 [code] List users: name and games columns (Plabs live, owner yes); 0003_admin_counts.sql copied byte for byte from claude-built-apps 1b6fc57; migrations pinned by sha256

2026-11-13 [code] Board: drag a piece to its new square (tap-tap still works); the new move shows at once instead of flashing through the old analysis

2026-11-13 [decision] Owner: halflife reads everyone's sheets for now (VITE_FREE_READER local-then-gateway); 1 sheet = 1 credit either way; the page does not wait

2026-11-13 [code] Queued sheets: "check back in 1-3 minutes"; GET/DELETE /api/my-jobs; the page collects finished readings into My games (job id = game id); privacy draft says photos can wait

2026-11-13 [note] Plabs: owner dropped the halflife charge/refund platform ask (he will handle it); reader readings take no credit for now

2026-11-13 [code] Reader sheets take one credit: one-token gateway call as the person at first delivery, once per job; queued only with a credit to spare; not deployed

2026-11-13 [code] Buy credits panel (start page, /pricing) with Paddle overlay checkout; off until VITE_PADDLE_* are set, admins see a preview; webhook and legal pages pending

2026-11-13 [decision] Owner: adds bought credits by hand for now (no webhook); deploys the reader charge and the buy panel

2026-11-13 [code] Board: the piece that moved stays put when touched; drop or tap it on its ringed starting square to take the move back, then play any piece; Put the move back

2026-11-15 [code] Several sheets at once: up to 10 photos, one game each (Add page / Same game as sheet N for 2-page games), read 2 at a time, saved in My games; stops when credits run out

2026-11-15 [code] Paddle webhook records transaction.completed (signature on raw body, one record per transaction, pack from price id); owner still grants credits by hand; list at /api/worker/payments

2026-11-15 [code] /install page: one Install button where the browser offers it, else per-browser steps (iPhone Share > Add to Home Screen, Android menu, desktop: open on the phone)

2026-11-15 [code] Android share target takes up to 10 photos (was 2), each its own sheet; shared photos keep their order past 10 (numeric sort)

2026-11-15 [decision] Owner: photo2pgn gets its own logo instead of the HintWise icon (favicon, header, app icons); the HintWise footer stays byte for byte

2026-11-15 [code] Logo: knight in viewfinder corners (src/assets/logo.svg), icons 192/512/maskable/apple-touch; install: "See how" tip on Android without the button, "already on this phone" via getInstalledRelatedApps

2026-11-15 [decision] Owner: publish the terms, refund and privacy pages (drafts of 13 Nov, unchanged) at /terms, /refunds, /privacy

2026-11-15 [code] Legal pages moved to public/, short addresses in netlify.toml, footer links; service worker keeps only app pages as the offline page

2026-11-15 [decision] Owner: prices public at /pricing before Paddle is connected (Paddle's website check); footer links Pricing, Terms, Refunds, Privacy

2026-11-15 [note] Paddle live pre-flight: Netlify had no VITE_PADDLE_*; PGN_PADDLE_PRICE_PACK_* were 500/1000, not pri_ ids; production webhook secret = the .env _WEBHOOK one

2026-11-15 [decision] Owner: live test through the paddle-live MCP; PGN_PADDLE_ENV and PGN_PADDLE_API_KEY (the sandbox key, unused) off Netlify, kept commented in local .env

2026-11-15 [code] Checkout: the client token prefix picks live or sandbox (live_/test_), VITE_PADDLE_ENV optional; a mismatch or a non-pri_ price sells nothing, admins see why

2026-11-15 [code] Paddle webhook: only Paddle's addresses (api.paddle.com/ips, kept an hour, never hard-coded), else 403; 503 when the list cannot be had; .env.example lists the Paddle settings

2026-11-15 [note] Readiness for Paddle verification: terms/refunds/privacy live (200, own titles), description present; contact only as the footer's project-idea email; catalog check pending paddle-live

2026-11-15 [decision] Owner (no answer, recommendation taken): with live Paddle settings only admins can buy until VITE_PADDLE_OPEN=yes, so the live test runs on the real domain before sales open

2026-11-15 [decision] Owner (no answer, recommendation taken): Contact link (builder@hintwise.org) in the app footer for Paddle verification; Retain pwCustomer skipped (no subscriptions)

2026-11-15 [note] Paddle live: catalog copied from sandbox (product, pack-20/50 prices), live_ client token, Bancontact off (card, PayPal, Apple Pay); Netlify has the live ids

2026-11-15 [note] Production webhook secret was not the live destination's (local value matched neither account); now the live endpoint_secret_key on Netlify production and in local .env

2026-11-15 [decision] Owner: live default payment link https://photo2pgn.hintwise.org/pricing; without one Paddle.js fails with transaction_default_checkout_url_not_set

2026-11-15 [note] Live $0 test passed: txn_01m7g0dhqzapvptp466wdykzkr completed, webhook 200 first try, payment record right, granted; test discount archived

2026-11-15 [decision] Owner: sales open, VITE_PADDLE_OPEN=yes on Netlify (production builds only); HANDOFF.md retired

2026-11-17 [feature] HintWise first-party analytics (owner: "add analytics to the rest of the apps", on the analytics branch, not deployed): public/hw-events.js copied byte for byte, the tag on every page, events read_started, pgn_exported, demo_opened; the privacy page says what is counted

2026-11-23 [decision] Owner, 23 Nov: "Merge all the apps": the analytics branch brought onto main (branch analytics-on-main); the merge deploys photo2pgn.hintwise.org; the origin https://photo2pgn.hintwise.org was registered by claude-built-apps shared/0016 (applied 17 Nov)

2026-11-26 [doc] privacy.html: the server keeps a device class (phone, tablet or computer) from the user agent; the daily salt is deleted once the next day's first visit is counted; date 26 November 2026

2026-11-26 [note] Correction to the 2026-11-23 line: the branch merged as PR #7 was analytics-merge (71dc723), not analytics-on-main

2026-11-26 [doc] privacy.html, review r1: the salt changes each UTC day, serves every HintWise app, goes at a later UTC day's first visit; redaction only as far as the script can tell; the export's demo flag named

2026-11-28 [code] Paddle webhook (owner, 28 Nov: "chess fix now"): the Paddle account also sells mychessmaster.net memberships and Paddle sends every destination every event, so a transaction.completed whose custom_data.app is a non-empty string other than "photo2pgn" is answered 200 {ignored, reason: "other app"} and not recorded; untagged sales and photo2pgn's are recorded as before; records already stored are left as they are

2026-11-28 [code] Paddle webhook, review r1 of #10: an untagged transaction.completed that carries a subscription_id (photo2pgn sells only one-time packs; mychessmaster.net's payment-method change would be one if Paddle completes it, and Paddle's sample shows custom_data null) is answered 200 {ignored, reason: "other app"} and not recorded; a photo2pgn tag always keeps the sale; the checkout and the webhook share one tag, PADDLE_APP_TAG in src/lib/credits.ts, with a round-trip test

2026-11-28 [feature] Admin panel "Payments to grant" (owner, 28 Nov: "p2p payments panel"; branch feat/payments-panel, not deployed): the open Paddle payments newest first; "Grant and mark done" adds the pack's credits to the account email from custom_data through credits-grant, then marks the payment granted (a claim on the record stops a second grant; a failed grant leaves it open); "Mark done" after a confirmation; GET /api/admin/payments and POST /api/admin/payments/:id/grant and /granted take the admin's own sign-in, checked with the gateway's check mode (admin: true); the worker-token routes are unchanged

2026-11-28 [code] Payments to grant, review r1 of #11: the claim is given back only when credits-grant certainly wrote nothing (400, 401, 403, 404); a thrown fetch, a 500, any other 5xx or a 2xx without a balance keeps it, and the row offers only Mark done after checking the balance; the panel never says the credits were not added when photo2pgn's server did not say; a record with no etag is never claimed (503 unguarded); Mark done waits while a claim is young (409 grant_running) and a grant marked meanwhile says so; the list skips and counts records it cannot read; each row shows what was paid, flags a payment under the list price and asks before granting it; granting to the checkout's user_id (RPP.1-5) not done: credits-grant's list mode returns no user_id
