// Vite dev-server plugin: serves /api/* (the CLI reader queue) from the same
// handlers the Netlify functions use, with an in-memory store.
//
// Sign-in only works on https://photo2pgn.hintwise.org, so locally the queue
// accepts the bearer token "dev" as one test user when PGN_DEV_USER is set.
import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig } from "../netlify/lib/config";
import { memoryKV } from "../netlify/lib/kv";
import { supabaseVerifier, type UserVerifier } from "../netlify/lib/auth";
import { handleConvert, handleJob, handleMyJobs, handleWorkerClaim, handleWorkerList, handleWorkerResult, type Deps } from "../netlify/lib/handlers";

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
      const path = new URL(request.url).pathname;
      if (path === "/api/convert") return send(res, await handleConvert(request, deps));
      const m = /^\/api\/jobs\/([^/]+)$/.exec(path);
      if (m) return send(res, await handleJob(request, decodeURIComponent(m[1]), deps));
      const mine = /^\/api\/my-jobs(?:\/([^/]+))?$/.exec(path);
      if (mine) return send(res, await handleMyJobs(request, mine[1] && decodeURIComponent(mine[1]), deps));
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
  const config = loadConfig();
  const devUser = process.env.PGN_DEV_USER;
  const real = supabaseVerifier(config.supabaseUrl, config.supabaseAnonKey);
  const verifyUser: UserVerifier = async (token) => (devUser && token === "dev" ? { id: devUser } : real(token));
  const deps: Deps = { config, jobs: memoryKV(), quota: memoryKV(), verifyUser };
  return {
    name: "photo2pgn-dev-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(apiListener(deps));
    },
  };
}
