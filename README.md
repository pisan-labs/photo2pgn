# photo2pgn: Photo to PGN

Turn a photo of a handwritten chess tournament scoresheet into a PGN file, at **https://photo2pgn.hintwise.org**.

For players, coaches, arbiters and club volunteers who have a pile of paper scoresheets and want the games in a database, an engine or an online analysis board.

1. Take a photo of the sheet with your phone (one or two pages), or upload one. Turn and crop it to the move table if needed.
2. Claude reads every move, the players, event, date, round, ratings and the result.
3. A chess engine replays the game, checks every move is legal, and repairs misreadings, even on sheets in awful handwriting (below).
4. You review on an analysis board: the board on the left, the moves on the right, and buttons (or the arrow keys, Home and End) to go to the start, back, forward and to the end. Corrected moves are amber, unclear ones blue, best guesses the later moves do not confirm red. Under the board, each move shows what is on the sheet and the legal moves to pick from. Fix a move by typing it, picking it, or tapping the piece and its square on the board; add a move the player forgot to write, or leave out one written by mistake. Add notes to the game.
5. Download the `.pgn` file, copy it, email or share it, or open it in Lichess (one click) or Chess.com.
6. Every game is kept in **My games**, on this device, and in your HintWise account when you are signed in, so a sheet photographed on a phone can be finished on a computer.

The demo button runs the whole review on a sample game with no account and no key.

**On a phone** it works like a native mobile app: add it to the home screen (the "install Photo to PGN" tip on Android, Share > Add to Home Screen on iPhone). On Android, a photo in the gallery can be shared straight into it.

## Sign in, or use your own key

The page offers two ways in, and the photo step opens once one is set up:

- **Sign in** (Google, or a sign-in link by email). Claude reads with HintWise's key through the HintWise gateway, within the person's credits: 3 free readings a UTC day and 9 an ISO week, then any credits they have been given or have bought (one credit, one game). The page shows "Use my N credits" and when new free ones come, from the gateway's check. When they run out, the page says until when and offers only the next option.
- **Your own Anthropic API key.** No account. The key goes only from your browser to Anthropic; HintWise never sees it. Tick "Remember on this device" to keep it in this browser.

**Admins** (people the owner adds with the platform's admin workflow) see an "Admin: add credits" panel on the start page: an email address and a whole number of credits (negative takes them back, never below zero), through the platform's `credits-grant` function (`src/lib/grant.ts`). Buying credits, through Paddle, comes next; the packs and the free amounts live in `src/lib/credits.ts`.

## What is stored, and where

- **Your photos** go from your browser to Claude to be read and are not kept. (The HintWise reader, below, would keep photos on HintWise's server, in Netlify Blobs, for up to a day and have them read by Claude Code on the owner's computer; it is off for the public since 13 Nov, and this page and the privacy policy must say so again before it is turned back on.) With your own API key, photos never go to HintWise's server.
- **Your games** (what was read, your corrections and notes, and the PGN, never the photos) are kept in this browser. When you are signed in they are also kept in your HintWise account, in Supabase (US East), where only you can see them. Delete a game from My games.
- **Your account**, if you sign in: your email address, kept by HintWise sign-in in Supabase (US East). It is one account for every HintWise app.
- **Lichess:** "Open in Lichess" imports the game there, and imported games are public on Lichess. Nothing is sent to Lichess or Chess.com unless you press their button.
- **Delete my account:** sign in, click your name at the top right to open the account panel, and choose "Delete my account". It deletes your account and your data in every HintWise app, saved games included.

## An honest limitation

A sheet is only as good as its writing. The engine finds the legal game that fits what Claude read, but a wrong move is caught only when it makes a later move impossible. Two different moves can lead to the same position (6. Bc4 or 6. Qa3 then 7. Qb3, say), or a misread move can be legal and leave every later move legal too (6. Bc4 written so it reads "a5" may become 6. a3), and then only the photo can tell. Every move that was not played exactly as read is flagged for you. Very faint, torn or crossed-out pages, and games recorded in descriptive notation, read less well.

## How bad handwriting is handled

Claude transcribes what it sees, with `_` for characters it cannot make out and up to five alternative readings for unclear moves. `src/lib/repair.ts` then searches for the cheapest legal game that fits the readings:

- **Readings, cheapest first:** the primary reading, one of Claude's alternatives, or the move as written in the sheet's language (piece letters in 15 languages).
- **Near misses:** a legal move one or two misread characters away (5/6, 3/8, c/e, a/d and so on count as easy confusions).
- **Guesses:** any legal move, priced by distance from what was read. A small bias favours natural moves (recaptures, captures, checks), which settles blank cells, even three in a row.
- **Backtracking:** when a move cannot be fitted cheaply, the engine reconsiders earlier moves that could be to blame: the same side's moves with that piece, and the last four plies. It tries every legal move there, even for a clearly written move, and replays the game after it.
- **Skipped or repeated moves:** when a player forgot to write a move, or wrote one twice, every later move sits in the other column. The engine also tries leaving a cell out, or inserting a missing move before it; the moves after it decide. You can do the same: type `e5 Nf6` to insert e5 before Nf6, or `-` to leave a cell out.
- **Wrong moves:** a player can write a legal move that was not the one played, or Claude can misread one into another legal move. The engine takes it as read until a later move becomes impossible, then backtracks to the moves that could be to blame and tries every legal move there; the change is flagged ("legal, but the moves after it only fit Bg4").
- **It never stops at a misreading:** it plays the best guess and goes on. Fixes that come in clusters, and fixes to clearly written moves, cost extra, so the explanation with the fewest scattered fixes wins. The only legal move is taken whatever the sheet says.
- **Confirmed or not:** a fix is "corrected" (amber) when at least the next two moves then fit as read, or it is the only legal move. Otherwise it is a "best guess" (red, dashed) for you to check, with the best guesses listed first: the moves the cheapest complete games play there, then the closest legal moves to what was read.
- **The only stops:** moves written after checkmate or stalemate, and a move you type that is not legal (your entry is final, so the game waits for you there).

The analysis runs in a Web Worker: well under a second on a clean sheet, about a second and a half on a hard one, and up to three seconds when the sheet stops making sense.

## For developers

### How a reading runs

```
own key:  browser ──────────────────────────────▶ api.anthropic.com
free:     browser ── session token ─▶ HintWise gateway (owner's key, caps) ─▶ Anthropic
reader:   browser ── session token ─▶ /api/convert ─▶ queue (Netlify Blobs)
                                                        ▲ list, claim │ photos, prompt, schema
          cli/pgn-worker.mjs (owner's machine) ─────────┘             ▼
             └─ claude -p (subscription) ─▶ reading ─▶ POST result ─▶ checked against the schema
```

The gateway passes only `model`, `max_tokens`, `system`, `messages` and `tools`, so Claude answers by calling one tool, `record_scoresheet`, whose input is checked against `src/lib/schema.ts`. Photos are shrunk in the browser to 1568 px and the request to under 1,000,000 bytes. The sign-in, gateway and account code in `src/lib/{supabase,auth,account,llm,signin-styles}.ts` is the HintWise platform template, unchanged apart from the app name.

The server side (Netlify Functions) is only the queue for the HintWise reader. It holds no Anthropic key. It needs a signed-in visitor (it asks Supabase Auth whose session token it was sent) and counts readings per person.

### The HintWise reader (your own machine)

Readings for signed-in people can be done by Claude Code on the owner's computer, on the Claude subscription. Set on Netlify `PGN_WORKER_TOKEN` (a long random value) and in `netlify.toml` `VITE_FREE_READER = "local-then-gateway"` (or `"local"`). Then, logged in to Claude Code with the subscription:

```sh
export PGN_WORKER_TOKEN=...            # same value as on Netlify
node cli/pgn-worker.mjs --site https://photo2pgn.hintwise.org --list    # what is waiting
node cli/pgn-worker.mjs --site https://photo2pgn.hintwise.org --once    # read it all, then exit
node cli/pgn-worker.mjs --site https://photo2pgn.hintwise.org           # keep watching (every 20 s)
```

- The CLI claims a job before reading it, for 15 minutes (`PGN_LEASE_MINUTES`); if it dies, the job goes back in the queue. Two machines can run it at once.
- `claude` runs with no tools at all and no hooks, plugins, MCP servers or CLAUDE.md (`--safe-mode`); the photos go in as image blocks, so text in a photo cannot make it run anything. It gets the site's own instructions and answer schema.
- It never bills per token: `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` are removed from claude's environment, and the CLI stops if claude reports any API key in use (`--allow-api-key` overrides).
- A failed reading goes back in the queue up to 3 times, then the visitor sees an error and the reading is not counted.
- The CLI checks in each time it asks for work. A reader counts as running when it checked in within `PGN_READER_IDLE_SECONDS` (default 60; keep it above the CLI's `--interval`), or is reading a job whose lease has not ended.
- With `local-then-gateway`, a reading goes to the queue only while a reader is running; otherwise, or when the queue is off or unreachable, it goes through the gateway at once. A queued job no reader has claimed within `VITE_LOCAL_FALLBACK_SECONDS` (default 120) is cancelled and read through the gateway. With `local`, a job waits up to `PGN_LOCAL_TIMEOUT_MINUTES` (default 30), so readings can pile up for a later `--once`.
- Open question for the owner: whether serving public visitors through a personal Claude subscription fits that subscription's terms. Check them before relying on this path for public traffic.
- To keep it running on a Mac, start it from a launchd agent or a `tmux` session. It keeps going through network blips and stops on setup problems (wrong token, missing `claude`).

### Chess TD hand-off

Chess TD (https://chesstd.hintwise.org) opens photo2pgn in a new tab to read one game:
`/?from=chesstd&v=1&ref=<16-32 chars>&return=<Chess TD URL>&event=&round=&board=&white=&black=&date=YYYY-MM-DD`.
A banner says whom the reading is for, Chess TD's pairing fills the game details, and once the game is checked
"Send to Chess TD" returns `{type: "photo2pgn/result", v: 1, ref, pgn, white, black, result, warnings: [{ply, kind, text}]}`
(`kind` is `filled`, `unsure`, `illegal` or `skipped`; `ply` counts half-moves of the PGN from 1):

- by `postMessage` to the tab that opened it, to the return URL's origin only, waiting 3 s for `{type: "photo2pgn/received", ref}` from that origin;
- otherwise by going to the return URL with `photo2pgn=<base64url(JSON)>` in its hash (never sent to a server), up to 16 KB.

The return URL counts only on an allowed origin (`RETURN_ORIGINS` in `src/lib/handoff.ts`: Chess TD, and localhost 5173 and 4173 for development). The hand-off is kept in this browser for a day, so it survives signing in. Cancel sends `{type: "photo2pgn/cancel", ref}`. The site sends no `Cross-Origin-Opener-Policy`, which would cut `window.opener`.

### Settings

Build (`netlify.toml`, all public):

| Variable | Default | Meaning |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | HintWise's | Sign-in and the gateway (public by design) |
| `VITE_FREE_READER` | `gateway` (owner, 13 Nov: every reading counts as a credit) | `gateway`, `local` or `local-then-gateway` |
| `VITE_LOCAL_FALLBACK_SECONDS` | `120` | `local-then-gateway`: wait this long for the HintWise reader |

Netlify Functions (only needed for the HintWise reader; every name starts with `PGN_`, so nothing meant for other tools is picked up):

| Variable | Default | Meaning |
|---|---|---|
| `PGN_WORKER_TOKEN` | unset | Bearer token for the CLI endpoints. Unset: the queue is off |
| `PGN_READER_PER_DAY` / `_PER_WEEK` / `_GLOBAL_PER_DAY` | 3 / 10 / 100 | Readings by the HintWise reader per person per UTC day and ISO week, and for everyone per day |
| `PGN_LOCAL_TIMEOUT_MINUTES` | `30` | A job no reader picks up fails after this long, and is not counted |
| `PGN_LEASE_MINUTES` | `15` | How long a claimed job is reserved for one CLI reader |
| `PGN_READER_IDLE_SECONDS` | `60` | No check-in from a CLI reader for this long: it counts as not running |
| `PGN_MAX_IMAGES`, `PGN_MAX_IMAGE_BYTES` | `2`, `2000000` | Pages per game, and the largest photo |

The gateway's caps (each person's credits) with the owner's key are set by the owner in the platform, not here.

### Develop

```sh
npm install
npm run dev        # the app; /api/* is served in memory (PGN_DEV_USER=me accepts the token "dev")
npm run check      # lint, typecheck, tests with coverage (85% minimum), build
npm run e2e        # Playwright walkthrough against vite preview, Anthropic faked in the page
```

Tests never touch the network: the template modules take fakes, the CLI tests use `dev/fake-claude.mjs`, and the walkthrough fakes api.anthropic.com in the browser. Sign-in only works on https://photo2pgn.hintwise.org.

### Layout

| Path | What |
|---|---|
| `src/lib/schema.ts`, `prompt.ts` | What Claude returns, and how it is asked (shared by the browser and the CLI reader) |
| `src/lib/read.ts`, `reading.ts`, `access.ts` | The reading: own key, gateway, or the queue with fallback; error messages; which ways in to offer, and out of credits |
| `src/lib/notation.ts`, `repair.ts` | Cleaning handwritten moves; the search that repairs misreadings |
| `src/lib/pgn.ts`, `export.ts` | PGN export; Lichess import, email, share sheet |
| `src/lib/library.ts` | My games: this device, plus the HintWise account when signed in |
| `src/lib/image.ts`, `shared.ts`, `install.ts` | Photo shrinking, turning and cropping; photos shared in from the gallery; installing the app |
| `public/sw.js`, `public/manifest.webmanifest` | Installable app: offline shell and the Android share target |
| `src/lib/{supabase,auth,account,llm,signin-styles}.ts` | HintWise platform template: sign-in, account deletion, model calls |
| `src/components/` | Upload, sign-in, review, board |
| `netlify/lib/`, `netlify/functions/` | The HintWise reader queue |
| `cli/pgn-worker.mjs` | The CLI reader |
| `supabase/migrations/` | 0001 registers the app with the gateway; 0002 adds `app_photo2pgn.games` (own rows only) |
| `dev/`, `e2e/`, `tests/` | Dev API, fake `claude`; Playwright; vitest |

The chess pieces are Cburnett's from Wikimedia Commons, used under the 3-clause BSD licence (`src/assets/pieces/LICENSE.txt`, served as `/piece-images-license.txt`). The board colours are chess-analyzer's "Walnut wood".
