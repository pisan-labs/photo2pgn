# Changes

2026-11-12 [scope] Photo to PGN: scoresheet photo to PGN on Netlify; owner key with per-person day/week caps and a global cap, or the visitor's own key. Sign-in and logo to come from another session.

2026-11-12 [decision] Claude call runs in a Netlify background function with jobs in Netlify Blobs, since sync functions stop at 60 s; browser polls /api/jobs/:id and resumes after reload.

2026-11-12 [decision] Claude transcribes with alternatives; a chess.js beam search decides legality and repairs. Flat stop cost so one red move beats a chain of guesses; clear legal moves stay.

2026-11-12 [decision] Settings are PGN_ prefixed and the Anthropic URL is explicit: CLAUDE_EFFORT=xhigh and ANTHROPIC_BASE_URL in the dev shell leaked into the app before the rename.

2026-11-12 [code] Vertical slice: upload, free/own-key choice, worker, review UI with board and legal-move picker, PGN export, demo game, mock Anthropic API; 70 tests; checked in netlify dev.
