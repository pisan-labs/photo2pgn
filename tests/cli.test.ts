// cli/pgn-worker.mjs end to end: a real HTTP server running the handlers,
// the CLI as a child process, and dev/fake-claude.mjs in place of claude.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AddressInfo } from "node:net";
import { loadConfig } from "../netlify/lib/config";
import { memoryKV } from "../netlify/lib/kv";
import type { Deps } from "../netlify/lib/handlers";
import { apiListener } from "../dev/devApi";

const run = promisify(execFile);
const TOKEN = "cli-test-token";
let server: Server;
let site = "";
const deps: Deps = {
  config: loadConfig({ PGN_WORKER_TOKEN: TOKEN, PGN_READER_PER_DAY: "50" }),
  jobs: memoryKV(),
  quota: memoryKV(),
  verifyUser: async (t) => (t === "visitor-session" ? { id: "visitor" } : null),
};

beforeAll(async () => {
  const listener = apiListener(deps);
  server = createServer((req, res) => void listener(req, res, () => res.writeHead(404).end()));
  await new Promise<void>((r) => server.listen(0, r));
  site = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server?.close());

async function submit(pages = 1) {
  const res = await fetch(`${site}/api/convert`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer visitor-session" },
    body: JSON.stringify({ images: Array(pages).fill({ mediaType: "image/png", data: btoa("png") }) }),
  });
  expect(res.status).toBe(202);
  return (await res.json()) as { jobId: string; viewToken: string };
}

async function status(job: { jobId: string; viewToken: string }) {
  return (await fetch(`${site}/api/jobs/${job.jobId}?token=${job.viewToken}`)).json();
}

function cli(args: string[], env: Record<string, string> = {}) {
  return run(process.execPath, ["cli/pgn-worker.mjs", "--site", site, "--claude", "dev/fake-claude.mjs", ...args], {
    env: { ...process.env, PGN_WORKER_TOKEN: TOKEN, ANTHROPIC_API_KEY: "sk-ant-should-be-removed", ...env },
  }).then(
    (r) => ({ code: 0, out: r.stdout + r.stderr }),
    (e) => ({ code: e.code as number, out: String(e.stdout) + String(e.stderr) }),
  );
}

describe("pgn-worker CLI", () => {
  it("lists, reads and uploads every waiting job", async () => {
    const a = await submit(1);
    const b = await submit(2);
    const listed = await cli(["--list"]);
    expect(listed.out).toContain("2 waiting");

    const r = await cli(["--once"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/done .* 3 moves/);
    const [sa, sb] = [await status(a), await status(b)];
    expect(sa.status).toBe("done");
    expect(sa.result.headers.white).toBe("Pages 1");
    expect(sb.result.headers.white).toBe("Pages 2");
  });

  it("stops and puts the job back when claude reports an API key in use", async () => {
    const job = await submit();
    const r = await cli(["--once"], { FAKE_API_KEY_SOURCE: "ANTHROPIC_API_KEY" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("billed per token");
    expect((await status(job)).status).toBe("queued");
    // A reader that is set up correctly then finishes it.
    expect((await cli(["--once"])).code).toBe(0);
    expect((await status(job)).status).toBe("done");
  });

  it("exits with a clear message when the token is wrong", async () => {
    const r = await cli(["--once"], { PGN_WORKER_TOKEN: "wrong" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("refused the worker token");
    expect(r.out).toContain("differs from the site's PGN_WORKER_TOKEN");
  });
});
