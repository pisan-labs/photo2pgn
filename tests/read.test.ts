import { describe, expect, it, vi } from "vitest";
import { CapReached, memoryStorage, setByokKey, type AnthropicLike, type Message } from "../src/lib/llm";
import { READ_TOOL_NAME, ReadFailed, extractionFrom, readRequest, readScoresheet } from "../src/lib/read";
import { extraction, rowsFrom, OPERA_GAME } from "./helpers";

const photo = { mediaType: "image/jpeg" as const, data: btoa("jpeg") };

function reply(content: unknown[], stop_reason = "tool_use"): Message {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 1800, output_tokens: 2400 },
  } as unknown as Message;
}

const toolCall = (input: unknown) => ({ type: "tool_use", id: "t1", name: READ_TOOL_NAME, input });

describe("readRequest", () => {
  it("sends the photos as image blocks, the tool, and the instruction to call it", () => {
    const r = readRequest([photo, photo]);
    expect(r.tools[0].name).toBe(READ_TOOL_NAME);
    expect(r.tools[0].input_schema).toMatchObject({ type: "object" });
    expect(r.system).toContain(`calling the ${READ_TOOL_NAME} tool exactly once`);
    const content = r.messages[0].content;
    expect(content.filter((b) => b.type === "image")).toHaveLength(2);
    expect(content.at(-1)).toMatchObject({ type: "text", text: expect.stringContaining("2 images") });
  });
});

describe("extractionFrom", () => {
  it("reads the tool call", () => {
    const ex = extraction(rowsFrom(OPERA_GAME));
    expect(extractionFrom(reply([toolCall(ex)])).rows).toHaveLength(17);
  });
  it("explains a refusal, a cut-off answer, a missing call and a bad shape", () => {
    const cases: [Message, string][] = [
      [reply([], "refusal"), "refused"],
      [reply([toolCall({ rows: [] })], "max_tokens"), "too_long"],
      [reply([{ type: "text", text: "Here is the game" }], "end_turn"), "unreadable"],
      [reply([toolCall({ rows: "nope" })]), "unreadable"],
    ];
    for (const [msg, code] of cases) {
      expect(() => extractionFrom(msg)).toThrow(ReadFailed);
      try {
        extractionFrom(msg);
      } catch (e) {
        expect((e as ReadFailed).code).toBe(code);
      }
    }
  });
});

describe("readScoresheet", () => {
  it("uses the visitor's own key in the browser", async () => {
    const storage = memoryStorage();
    setByokKey("sk-ant-visitor", storage);
    const create = vi.fn(async (_body: unknown) => reply([toolCall(extraction(rowsFrom(OPERA_GAME)))]));
    const createAnthropic = vi.fn((key: string): AnthropicLike => {
      expect(key).toBe("sk-ant-visitor");
      return { messages: { create } };
    });
    const r = await readScoresheet([photo], { mode: "byok", storage, createAnthropic });
    expect(r.extraction.headers.white).toBe("Morphy, Paul");
    expect(r.usage.output_tokens).toBe(2400);
    expect(create.mock.calls[0][0]).toMatchObject({ max_tokens: 16000, tools: [{ name: READ_TOOL_NAME }] });
  });

  it("sends the gateway call with the session token and surfaces caps", async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "cap", scope: "app-user-day", resets_at: "2026-11-13T00:00:00Z" }), { status: 429 }),
    );
    const err = await readScoresheet([photo], {
      mode: "gateway",
      getToken: async () => "session-token",
      fetch,
      gatewayUrl: "https://gw.test/llm",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(CapReached);
    expect(err.scope).toBe("app-user-day");
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer session-token");
    expect(JSON.parse(String(init.body))).toMatchObject({ app: "photo2pgn", max_tokens: 8000 });
  });
});
