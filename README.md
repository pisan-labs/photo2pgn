# photo2pgn: Photo to PGN

Turn a photo of a handwritten chess tournament scoresheet into a PGN file, at **https://photo2pgn.hintwise.org**.

For players, coaches, arbiters and club volunteers who have a pile of paper scoresheets and want the games in a database, an engine or an online analysis board.

1. Take or upload a photo of the sheet (one or two pages).
2. Claude reads every move, the players, event, date, round, ratings and the result.
3. A chess engine replays the game, checks every move is legal, and repairs misreadings, even on sheets in awful handwriting (below).
4. You review: corrected or guessed moves are amber, unclear ones blue, a move left to you red. Each move shows the board, what is on the sheet, and the legal moves to pick from.
5. Download the `.pgn` file or copy the text.

The demo button runs the whole review on a sample game with no account and no key.

## Two ways to have it read

- **Free, with a HintWise account** (Google, or a sign-in link by email). It reads with HintWise's key through the HintWise gateway, within a daily and weekly allowance. When the allowance is used up, the page says which one and when it resets, and offers the next option.
- **Your own Anthropic API key.** No account and no allowance. The key goes only from your browser to Anthropic; HintWise never sees it. Tick "Remember on this device" to keep it in this browser.

## What is stored, and where

- **Your photos** go from your browser to Claude to be read and are not kept. The one exception is the HintWise reader (below): there they wait on our server (Netlify) until they are read, then are deleted, at the latest after a day.
- **Your games** stay in your browser. Nothing about them is stored on a server.
- **Your account**, if you sign in: your email address, kept by HintWise sign-in in Supabase (US East). It is one account for every HintWise app.
- **Delete my account:** sign in, open the account panel (top right), and choose "Delete my account". It deletes your account and your data in every HintWise app.

## An honest limitation

A sheet is only as good as its writing. The engine finds the legal game that fits what Claude read, but two different moves can sometimes lead to the same position (6. Bc4 or 6. Qa3 then 7. Qb3, say), and then only the photo can tell. Such moves are always flagged for you. Very faint, torn or crossed-out pages, and games recorded in descriptive notation, read less well.

## How bad handwriting is handled

Claude transcribes what it sees, with `_` for characters it cannot make out and up to five alternative readings for unclear moves. `src/lib/repair.ts` then searches for the cheapest legal game that fits the readings:

- **Readings, cheapest first:** the primary reading, one of Claude's alternatives, or the move as written in the sheet's language (piece letters in 15 languages).
- **Near misses:** a legal move one or two misread characters away (5/6, 3/8, c/e, a/d and so on count as easy confusions).
- **Guesses:** any legal move, priced by distance from what was read. A small bias favours natural moves (recaptures, captures, checks), which settles blank cells, even three in a row.
- **Backtracking:** when a move cannot be fitted cheaply, the engine reconsiders earlier moves that could be to blame: the same side's moves with that piece, and the last four plies. It tries every legal move there, even for a clearly written move, and replays the game after it.
- **Skipped or repeated moves:** when a player forgot to write a move, or wrote one twice, every later move sits in the other column. The engine also tries leaving a cell out, or inserting a missing move before it; the moves after it decide. You can do the same: type `e5 Nf6` to insert e5 before Nf6, or `-` to leave a cell out.
- **Knowing when to stop:** stopping costs a little per unplayed move; fixes that come in clusters, and fixes to clearly written moves, cost extra. A guess that makes the next 20 moves fit wins; a different game forced onto the sheet, or a smudge two moves from the end, is left as one red move for you.

The analysis runs in a Web Worker and takes up to about a second on a hard sheet.

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

Free readings can be read by Claude Code on the owner's computer, on the Claude subscription. Set on Netlify `PGN_WORKER_TOKEN` (a long random value) and in `netlify.toml` `VITE_FREE_READER = "local-then-gateway"` (or `"local"`). Then, logged in to Claude Code with the subscription:

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
- With `local-then-gateway`, the browser cancels a job no reader has claimed within `VITE_LOCAL_FALLBACK_SECONDS` (default 120) and reads it through the gateway instead. With `local`, a job waits up to `PGN_LOCAL_TIMEOUT_MINUTES` (default 30).
- To keep it running on a Mac, start it from a launchd agent or a `tmux` session. It keeps going through network blips and stops on setup problems (wrong token, missing `claude`).

### Settings

Build (`netlify.toml`, all public):

| Variable | Default | Meaning |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | HintWise's | Sign-in and the gateway (public by design) |
| `VITE_FREE_READER` | `gateway` | `gateway`, `local` or `local-then-gateway` |
| `VITE_LOCAL_FALLBACK_SECONDS` | `120` | `local-then-gateway`: wait this long for the HintWise reader |

Netlify Functions (only needed for the HintWise reader; every name starts with `PGN_`, so nothing meant for other tools is picked up):

| Variable | Default | Meaning |
|---|---|---|
| `PGN_WORKER_TOKEN` | unset | Bearer token for the CLI endpoints. Unset: the queue is off |
| `PGN_READER_PER_DAY` / `_PER_WEEK` / `_GLOBAL_PER_DAY` | 3 / 10 / 100 | Readings by the HintWise reader per person per UTC day and ISO week, and for everyone per day |
| `PGN_LOCAL_TIMEOUT_MINUTES` | `30` | A job no reader picks up fails after this long, and is not counted |
| `PGN_LEASE_MINUTES` | `15` | How long a claimed job is reserved for one CLI reader |
| `PGN_MAX_IMAGES`, `PGN_MAX_IMAGE_BYTES` | `2`, `2000000` | Pages per game, and the largest photo |

The gateway's caps for free readings with the owner's key are set by the owner in the platform, not here.

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
| `src/lib/read.ts`, `reading.ts` | The reading: own key, gateway, or the queue with fallback; error messages |
| `src/lib/notation.ts`, `repair.ts` | Cleaning handwritten moves; the search that repairs misreadings |
| `src/lib/pgn.ts` | PGN export |
| `src/lib/{supabase,auth,account,llm,signin-styles}.ts` | HintWise platform template: sign-in, account deletion, model calls |
| `src/components/` | Upload, sign-in, review, board |
| `netlify/lib/`, `netlify/functions/` | The HintWise reader queue |
| `cli/pgn-worker.mjs` | The CLI reader |
| `supabase/migrations/` | Registers the app with the gateway (stores nothing else) |
| `dev/`, `e2e/`, `tests/` | Dev API, fake `claude`; Playwright; vitest |
