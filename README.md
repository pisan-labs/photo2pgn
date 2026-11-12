# photo2png: Photo to PGN

Turn a photo of a handwritten chess tournament scoresheet into a PGN file.

1. Take or upload a photo of the sheet (one or two pages).
2. Claude reads every move cell, the header (players, event, date, round, ratings) and the result.
3. A chess engine replays the game. It checks that each move is legal and repairs misreadings. It can use one of Claude's alternative readings, the move as written in the sheet's own language, or the legal move one misread character away. For a blank cell, it picks the move that fits the moves after it.
4. You review: corrected moves are amber, unclear ones blue, impossible ones red. Each move shows the board, what is on the sheet, and a list of the legal moves to pick from.
5. Download the `.pgn` file or copy the text.

The demo button runs the whole review on a sample game with no API call.

## How a conversion runs

```
browser ──POST /api/convert──▶ convert (sync function)
  │                              ├─ checks the free caps (owner key only)
  │                              ├─ stores photos + job record in Netlify Blobs
  │                              └─ starts convert-worker ──▶ background function (up to 15 min)
  │                                                            ├─ Claude reads the photos
  │                                                            ├─ writes the result to the job
  └──GET /api/jobs/:id (every 2.5 s)◀──────────────────────────┘  └─ deletes the photos
```

Netlify's synchronous functions stop at 60 seconds, and a careful read of a full sheet can take longer, so the Claude call runs in a background function. The browser keeps the job id, so a reload or a locked phone picks the wait back up.

## Reading on your own machine (CLI reader)

Free conversions can be read by Claude Code on your own computer, on your Claude subscription, instead of the API key:

```
browser ─▶ convert ─▶ job waits in the queue (Blobs)
                         ▲            │
cli/pgn-worker.mjs ──────┘ list, claim ▼ photos + prompt + schema
   └─ claude -p (subscription) ─▶ reading ─▶ POST result ─▶ site checks it against the schema
```

Set on Netlify: `PGN_FREE_READER=local` (or `local-then-api`) and a long random `PGN_WORKER_TOKEN`. Then on your machine, logged in to Claude Code with your subscription:

```sh
export PGN_WORKER_TOKEN=...            # same value as on Netlify
node cli/pgn-worker.mjs --site https://your-site --list    # what is waiting
node cli/pgn-worker.mjs --site https://your-site --once    # read it all, then exit
node cli/pgn-worker.mjs --site https://your-site           # keep watching (every 20 s)
```

- The CLI claims a job before reading it. The claim lasts 15 minutes (`PGN_LEASE_MINUTES`). If the CLI dies, the job goes back in the queue. Two machines can run the CLI at once.
- `claude` runs with no tools at all, no hooks, plugins, MCP servers or CLAUDE.md (`--safe-mode`). The photos go in as image blocks, so text in a photo cannot make it run anything. It gets the site's own instructions and answer schema, so it reads sheets exactly as the API reader does.
- It never bills per token. `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` are removed from claude's environment, and the CLI stops if claude reports any API key in use (`--allow-api-key` overrides).
- A failed reading is put back in the queue up to 3 times, then the visitor sees an error and the free conversion is given back.
- With `local-then-api`, a job no reader claims within `PGN_LOCAL_FALLBACK_SECONDS` (default 120) is read with `PGN_OWNER_API_KEY` instead. With `local`, it waits up to `PGN_LOCAL_TIMEOUT_MINUTES` (default 30) and then fails with a refund.
- To keep it running on a Mac, start it from a launchd agent or a `tmux` session. It keeps going through network blips and stops on setup problems (wrong token, missing `claude`).

## Who pays

- **Free conversions** use the site owner's Anthropic key (`PGN_OWNER_API_KEY`), with caps per person per day and per week and a global daily cap as a spending backstop. A failed conversion is not counted.
- **Own key**: the visitor pastes an Anthropic key. It travels with the request to the background worker and on to Anthropic. It is never written to storage or logs. If the visitor ticks "Remember on this device", it is saved in their browser's localStorage only.

Until sign-in is added, a "person" for the caps is a salted hash of the IP address. Everyone on a shared Wi-Fi (a whole tournament hall) shares one cap. Sign-in will replace this (see `netlify/lib/identity.ts`).

Cost per sheet with Claude Opus 5.5 at `high` effort is an estimate, not yet measured: about $0.10 to $0.25 (a few thousand input tokens for the photo, 4k to 10k output tokens including thinking).

## Settings (Netlify environment variables)

Every name starts with `PGN_`, so keys and settings meant for other tools (`ANTHROPIC_API_KEY`, `CLAUDE_*`) are never picked up by accident.

| Variable | Default | Meaning |
|---|---|---|
| `PGN_OWNER_API_KEY` | unset | Anthropic key for free conversions. Unset: only own-key conversions are offered (unless a CLI reader is set up). |
| `PGN_FREE_READER` | `api` | Who reads free conversions: `api` (owner key), `local` (CLI reader), `local-then-api`. |
| `PGN_WORKER_TOKEN` | unset | Bearer token for the CLI reader endpoints. Unset: those endpoints are off. |
| `PGN_LOCAL_FALLBACK_SECONDS` | `120` | `local-then-api`: wait this long for a CLI reader before using the owner key. |
| `PGN_LOCAL_TIMEOUT_MINUTES` | `30` | `local`: a job no reader picks up fails after this long, with a refund. |
| `PGN_LEASE_MINUTES` | `15` | How long a claimed job is reserved for one CLI reader. |
| `PGN_FREE_PER_DAY` | `3` | Free conversions per person per UTC day. |
| `PGN_FREE_PER_WEEK` | `10` | Free conversions per person per ISO week (Monday, UTC). |
| `PGN_FREE_GLOBAL_PER_DAY` | `100` | All free conversions per UTC day. |
| `PGN_CLAUDE_MODEL` | `claude-opus-5-5` | Model used to read sheets. |
| `PGN_CLAUDE_EFFORT` | `high` | `low`, `medium`, `high`, `xhigh` or `max`. |
| `PGN_MAX_IMAGES` | `2` | Pages per game. |
| `PGN_MAX_IMAGE_BYTES` | `2000000` | Largest photo accepted (the browser shrinks photos to about 1.9 MB). |
| `PGN_IDENTITY_SALT` | `photo2pgn` | Salt for the IP hash. Set a random value in production. |
| `PGN_ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | Only for local tests against the mock API. |

Requests use server-side refusal fallbacks (`fallbacks: "default"`), so a rare safety decline is retried on a fallback model in the same call.

## Deploy on Netlify

1. Create a site from this repository. `netlify.toml` sets the build (`npm run build`, publish `dist`) and the functions.
2. Set `PGN_OWNER_API_KEY` and `PGN_IDENTITY_SALT` (and any caps) under Site configuration > Environment variables.
3. Deploy. Netlify Blobs needs no setup. A scheduled function deletes old jobs and counters daily.

## Develop

```sh
npm install
MOCK_CLAUDE=1 npm run dev        # whole app, fake reader returns the demo game, no cost
npm run dev                      # real Claude: needs PGN_OWNER_API_KEY or an own key in the UI
npm run check                    # typecheck, tests, build
```

`npm run dev` serves `/api/*` from the same handlers as the Netlify functions, with an in-memory store. To run the real Netlify runtime (Blobs, background function) against a fake Anthropic API:

```sh
npm run build
node dev/mock-anthropic.mjs 4010 &
PGN_OWNER_API_KEY=sk-ant-test PGN_ANTHROPIC_BASE_URL=http://localhost:4010 \
  netlify dev --offline --dir dist --framework "#static"
```

If `NODE_OPTIONS` contains `--use-openssl-ca`, clear it for `netlify dev` (its worker threads refuse that flag).

## Layout

| Path | What |
|---|---|
| `src/lib/schema.ts` | What Claude returns (zod schema, shared by worker and browser) |
| `src/lib/notation.ts` | Cleaning handwritten moves, piece letters in 15 languages, near-miss scoring |
| `src/lib/repair.ts` | Replays the game and repairs misreadings (beam search) |
| `src/lib/pgn.ts` | PGN export |
| `src/components/` | Upload, review, board |
| `netlify/lib/` | Handlers, caps, Claude call, Blobs store, settings |
| `netlify/functions/` | Netlify entry points |
| `cli/pgn-worker.mjs` | CLI reader: reads queued photos with your local Claude Code |
| `dev/` | Local API for `vite`, mock Anthropic API, fake `claude` for CLI tests |
| `tests/` | Vitest |
