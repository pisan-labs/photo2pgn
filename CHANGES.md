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
