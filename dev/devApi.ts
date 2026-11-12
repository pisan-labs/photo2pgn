// Vite dev-server plugin: serves /api/* from the same handlers the Netlify
// functions use, with an in-memory store and the worker run in-process.
// MOCK_CLAUDE=1 answers with the demo game after a short wait, so the whole
// flow can be tried without an API key or any cost.
import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig } from "../netlify/lib/config";
import { memoryKV } from "../netlify/lib/kv";
import { readScoresheet } from "../netlify/lib/claude";
import {
  handleConvert,
  handleJob,
  handleQuota,
  handleWorkerClaim,
  handleWorkerList,
  handleWorkerResult,
  runWorker,
  type Deps,
} from "../netlify/lib/handlers";
import { DEMO_EXTRACTION } from "../src/demo/sample";

async function toRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  return new Request(`http://${req.headers.host}${req.url}`, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
  });
}

async function send(res: ServerResponse, r: Response) {
  res.statusCode = r.status;
  r.headers.forEach((v, k) => res.setHeader(k, v));
  res.end(Buffer.from(await r.arrayBuffer()));
}

/** A Node request handler serving /api/* from the shared handlers. */
export function apiListener(deps: Deps) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url ?? "";
    if (!url.startsWith("/api/")) return next();
    try {
      const request = await toRequest(req);
      const ip = req.socket.remoteAddress;
      const path = new URL(request.url).pathname;
      if (path === "/api/quota") return send(res, await handleQuota(request, ip, deps));
      if (path === "/api/convert") return send(res, await handleConvert(request, ip, deps));
      const m = /^\/api\/jobs\/([^/]+)$/.exec(path);
      if (m) return send(res, await handleJob(request, decodeURIComponent(m[1]), deps));
      if (path === "/api/worker/jobs") return send(res, await handleWorkerList(request, deps));
      const w = /^\/api\/worker\/jobs\/([^/]+)\/(claim|result)$/.exec(path);
      if (w && w[2] === "claim") return send(res, await handleWorkerClaim(request, decodeURIComponent(w[1]), deps));
      if (w && w[2] === "result") return send(res, await handleWorkerResult(request, decodeURIComponent(w[1]), deps));
      res.statusCode = 404;
      res.end("not found");
    } catch (err) {
      console.error(err);
      res.statusCode = 500;
      res.end("dev api error");
    }
  };
}

export function devApi(): Plugin {
  const mock = process.env.MOCK_CLAUDE === "1";
  const config = loadConfig({ ...process.env, ...(mock ? { PGN_OWNER_API_KEY: "sk-ant-mock-owner" } : {}) });
  const deps: Deps = {
    config,
    jobs: memoryKV(),
    quota: memoryKV(),
    readScoresheet: mock
      ? async () => {
          await new Promise((r) => setTimeout(r, Number(process.env.MOCK_DELAY_MS ?? 3000)));
          return { extraction: DEMO_EXTRACTION, usage: { inputTokens: 0, outputTokens: 0, model: "mock" } };
        }
      : readScoresheet,
    startWorker: async (body) => {
      setTimeout(() => void runWorker(body, deps), 0);
    },
  };
  return {
    name: "photo2pgn-dev-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(apiListener(deps));
    },
  };
}
