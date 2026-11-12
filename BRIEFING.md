# Briefing

- Purpose: a web app that turns a photo of a handwritten chess tournament scoresheet into a downloadable PGN file. A HintWise app, deployed on Netlify.
- Scope (2026-11-12): upload 1 to 2 photos; Claude (Opus 5.5, structured output, adaptive thinking, effort high) reads moves and header; a deterministic engine (chess.js + beam search) checks legality and proposes repairs; the person reviews and edits; PGN download or copy. A demo game runs the review with no API call.
- Who pays: free conversions on the owner's key (`PGN_OWNER_API_KEY`) capped per person per day (3), per week (10) and globally per day (100), all configurable; or the visitor's own key, passed through and never stored.
- Key decisions:
  - Claude runs in a Netlify background function (15 min limit), because sync functions stop at 60 s. Job records and photos live in Netlify Blobs (strong consistency). The browser polls and resumes after a reload. Photos are deleted once read; jobs after a day.
  - Claude reads and the engine decides: the prompt asks for faithful transcription, `_` for unreadable characters and alternatives; the engine (beam search) picks the cheapest legal game. For awful handwriting (2026-11-12, owner) it guesses any legal move with a natural-move prior and backtracks to earlier moves that could be to blame, even clearly written ones. Stopping costs 1 per unplayed ply; clustered fixes and fixes to clear readings cost extra, so garbage stops at one red move. A person's illegal edit stops there; earlier moves are never rewritten to fit it. Shifted sheets (a move skipped or written twice): a cell can be left out (cost 3.5) or a missing move inserted before it (cost 4), tried only when its reading is not legal; PGN numbers come from the game.
  - Free conversions can be read by the owner's machine: `cli/pgn-worker.mjs` pulls queued jobs and reads them with local Claude Code on the subscription (`PGN_FREE_READER=local|local-then-api`, `PGN_WORKER_TOKEN`).
  - Caps use compare-and-swap counters in Blobs. A failed conversion is given back.
  - All settings are `PGN_` prefixed. `ANTHROPIC_API_KEY`, `CLAUDE_EFFORT` and `ANTHROPIC_BASE_URL` from other tools are ignored; the API URL is passed explicitly.
- Pending from the owner: sign-in instructions and the HintWise logo (another session will send them). Until sign-in, a person for the caps is a salted hash of the IP address.
- Non-goals for now: storing games server-side, accounts beyond sign-in for caps, PDF or multi-game sheets, a manual move-entry mode.
