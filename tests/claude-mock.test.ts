// readScoresheet against a local stand-in for the Messages API: checks the
// request the SDK sends and that the streamed structured reply is parsed.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { readScoresheet, ReadError } from "../netlify/lib/claude";

const PORT = 4011;
let mock: ChildProcess;
const log: string[] = [];

beforeAll(async () => {
  mock = spawn(process.execPath, ["dev/mock-anthropic.mjs", String(PORT)], { env: { ...process.env, MOCK_DELAY_MS: "10" } });
  await new Promise<void>((resolve, reject) => {
    mock.stdout!.on("data", (d: Buffer) => {
      log.push(...d.toString().trim().split("\n"));
      if (d.toString().includes("mock anthropic")) resolve();
    });
    mock.on("error", reject);
  });
});

afterAll(() => {
  mock?.kill();
});

const images = [{ mediaType: "image/jpeg" as const, data: btoa("jpeg bytes") }];

describe("readScoresheet", () => {
  it("streams a structured reply and parses it", async () => {
    const r = await readScoresheet({
      apiKey: "sk-ant-test",
      model: "claude-opus-5-5",
      effort: "high",
      images,
      baseURL: `http://localhost:${PORT}`,
    });
    expect(r.extraction.headers.white).toBe("White, Wendy");
    expect(r.extraction.rows).toHaveLength(17);
    expect(r.usage).toMatchObject({ inputTokens: 3000, outputTokens: 2100 });
    const sent = JSON.parse(log.find((l) => l.startsWith("{"))!);
    expect(sent).toMatchObject({
      path: "/v1/messages",
      model: "claude-opus-5-5",
      stream: true,
      thinking: { type: "adaptive" },
      effort: "high",
      format: "json_schema",
      fallbacks: "default",
    });
    expect(sent.beta).toContain("server-side-fallback-2026-07-01");
    expect(sent.key).toBe("sk-ant-tes…");
    expect(sent.images).toEqual(["image/jpeg 16b64"]);
  });

  it("reports a rejected key as bad_key", async () => {
    await expect(
      readScoresheet({ apiKey: "sk-ant-bad", model: "claude-opus-5-5", effort: "high", images, baseURL: `http://localhost:${PORT}` }),
    ).rejects.toMatchObject({ code: "bad_key" } satisfies Partial<ReadError>);
  });
});
