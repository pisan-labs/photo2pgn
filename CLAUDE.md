# photo2pgn

Photo of a chess scoresheet to PGN. Vite + React front end, Netlify Functions (TypeScript) back end, Netlify Blobs for jobs and caps. Read BRIEFING.md first.

## Before committing

- `npm run check`: typecheck, tests (vitest), build. There is no linter configured.
- Do not call the real Anthropic API in tests. `dev/mock-anthropic.mjs` stands in for it; `MOCK_CLAUDE=1 npm run dev` runs the app with no cost.

## Conventions

- App settings are environment variables prefixed `PGN_` (see README). Never read `ANTHROPIC_API_KEY` or `CLAUDE_*` in app code.
- The visitor's own API key must never be stored or logged on the server.
- Request handling lives in `netlify/lib/handlers.ts` with injected dependencies; `netlify/functions/*` are thin wrappers.
