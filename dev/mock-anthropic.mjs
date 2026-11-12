// A stand-in for the Anthropic Messages API, for local end-to-end tests at no
// cost: answers every POST /v1/messages with the demo game as a streamed
// structured-output reply, and logs what the SDK sent.
// Run: node dev/mock-anthropic.mjs [port]; then set ANTHROPIC_BASE_URL.
import http from "node:http";

const port = Number(process.argv[2] ?? 4010);
const delay = Number(process.env.MOCK_DELAY_MS ?? 1500);
const moves = "e4 e5 Nf3 d6 d4 Bg4 dxe6 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qd3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 0-0-0 Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#".split(" ");
const ply = (m) => (m ? { written: m, san: m, alternatives: m === "Qd3" ? ["Qb3"] : [], legibility: m === "Qd3" ? "unclear" : "clear" } : null);
const extraction = {
  isScoresheet: true,
  notationLanguage: "en",
  headers: { event: "Mock Open", site: "Localhost", date: "2026.11.12", round: "3", board: "7", white: "White, Wendy", black: "Black, Bob", whiteElo: "1850", blackElo: "", result: "1-0" },
  rows: Array.from({ length: 17 }, (_, r) => ({ number: r + 1, white: ply(moves[2 * r]), black: ply(moves[2 * r + 1]) })),
  notes: "",
};

http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = JSON.parse(body || "{}");
      const key = String(req.headers["x-api-key"] ?? req.headers.authorization ?? "").replace(/^Bearer /, "");
      const c0 = parsed.messages?.[0]?.content;
      const imgs = (Array.isArray(c0) ? c0 : []).filter((b) => b.type === "image");
      console.log(
        JSON.stringify({
          path: req.url,
          key: key.slice(0, 10) + "…",
          beta: req.headers["anthropic-beta"],
          model: parsed.model,
          stream: parsed.stream,
          thinking: parsed.thinking,
          effort: parsed.output_config?.effort,
          format: parsed.output_config?.format?.type,
          fallbacks: parsed.fallbacks,
          images: imgs.map((i) => `${i.source.media_type} ${i.source.data.length}b64`),
        }),
      );
      if (key.includes("bad")) {
        res.writeHead(401, { "content-type": "application/json" });
        return res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }));
      }
      setTimeout(() => {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
        ev("message_start", {
          message: { id: "msg_mock", type: "message", role: "assistant", model: parsed.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 3000, output_tokens: 1 } },
        });
        ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
        const text = JSON.stringify(extraction);
        for (let i = 0; i < text.length; i += 400) ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: text.slice(i, i + 400) } });
        ev("content_block_stop", { index: 0 });
        ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2100 } });
        ev("message_stop", {});
        res.end();
      }, delay);
    });
  })
  .listen(port, () => console.log(`mock anthropic on :${port}`));
