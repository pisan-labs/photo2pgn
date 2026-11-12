#!/usr/bin/env node
// Stands in for `claude -p` in tests of cli/pgn-worker.mjs: checks the flags
// the worker must pass, reads the stream-json message, and answers with a
// fixed reading. FAKE_API_KEY_SOURCE=ANTHROPIC_API_KEY simulates a key in use.
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const need = ["-p", "--safe-mode", "--tools", "--json-schema", "--system-prompt", "--input-format", "--no-session-persistence"];
for (const flag of need) if (!args.includes(flag)) fail(`missing ${flag}`);
if (args[args.indexOf("--tools") + 1] !== "") fail("tools must be empty");
if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) fail("API key variables leaked into claude");

const input = JSON.parse(readFileSync(0, "utf8").trim().split("\n")[0]);
const images = input.message.content.filter((b) => b.type === "image").length;
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
out({ type: "system", subtype: "init", model: "claude-opus-5-5", apiKeySource: process.env.FAKE_API_KEY_SOURCE ?? "none", tools: ["StructuredOutput"] });
if (process.env.FAKE_API_KEY_SOURCE) setTimeout(() => {}, 5000); // wait to be killed
else {
  const moves = "e4 e5 Nf3 Nc6 Bb5 a6".split(" ");
  const ply = (m) => (m ? { written: m, san: m, alternatives: [], legibility: "clear" } : null);
  out({
    type: "result",
    subtype: "success",
    is_error: false,
    structured_output: {
      isScoresheet: true,
      notationLanguage: "en",
      headers: { event: "Fake", site: "", date: "", round: "", board: "", white: `Pages ${images}`, black: "", whiteElo: "", blackElo: "", result: "*" },
      rows: [0, 1, 2].map((r) => ({ number: r + 1, white: ply(moves[2 * r]), black: ply(moves[2 * r + 1]) })),
      notes: "",
    },
    usage: { input_tokens: 10, output_tokens: 20 },
    modelUsage: { "claude-opus-5-5": {} },
  });
}

function fail(msg) {
  process.stdout.write(JSON.stringify({ type: "result", subtype: "error", is_error: true, result: `fake-claude: ${msg}` }) + "\n");
  process.exit(1);
}
