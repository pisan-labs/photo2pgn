# photo2pgn

Photo of a chess scoresheet to PGN, a HintWise app (option B: its own repository). Vite + React; the reading happens in the browser (visitor's own key, or the HintWise gateway); Netlify Functions + Blobs serve only the queue for the owner's CLI reader; for a sheet it read, a function takes the person's one credit with a one-token gateway call made with their own sign-in token. Read BRIEFING.md first; the platform rules are in pisanuw/claude-built-apps `docs/new-app-guide.md`.

## Before committing

- `npm run check`: lint, typecheck, tests with coverage (85% minimum), build. `npm run e2e` for the Playwright walkthrough.
- Conventional Commits (`feat: ...`, `fix: ...`); `[skip netlify]` in docs-only commits, since every push to the deployed branch costs Netlify credits.
- Tests never touch the network: no real Anthropic calls (fakes, `dev/fake-claude.mjs`, the walkthrough fakes api.anthropic.com).

## Rules

- Never put an Anthropic key in Netlify, the app or a server function. The owner's key is used only through the HintWise gateway and its caps; a visitor's key goes only from the browser to api.anthropic.com.
- `src/lib/{supabase,auth,account,llm,signin-styles}.ts` are the platform template: change them only by copying a newer template.
- The HintWise footer in `index.html` is byte for byte from `scripts/site-footer.mjs` (sha256 test in `tests/footer.test.ts`).
- Server settings are environment variables prefixed `PGN_`. Never read `ANTHROPIC_*` or `CLAUDE_*` in app code.
- Queue handlers live in `netlify/lib/handlers.ts` with injected dependencies; `netlify/functions/*` are thin wrappers.
