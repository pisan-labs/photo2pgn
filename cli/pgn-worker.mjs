#!/usr/bin/env node
// pgn-worker: reads queued scoresheet photos with your local Claude Code
// (your subscription, not an API key) and uploads the readings to the site.
//
//   PGN_WORKER_TOKEN=... node cli/pgn-worker.mjs --site https://photo2pgn.example.org
//
// It asks the site for waiting jobs, claims one (the site reserves it for
// this machine for a while), sends the photos to `claude -p` together with
// the site's own instructions and answer schema, and posts the answer back.
// The site checks the answer against the schema before the visitor sees it.
//
// Safety: claude runs with no tools at all (--tools ""), no hooks, plugins,
// MCP servers or CLAUDE.md (--safe-mode), and the photos go in as image
// blocks on stdin, so text in a photo cannot make it do anything. The
// ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN variables are removed from its
// environment, and a job is stopped if claude reports any API key in use, so
// readings are never billed per token unless you pass --allow-api-key.
import { spawn } from "node:child_process";
import { hostname, tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const HELP = `Usage: node cli/pgn-worker.mjs --site URL [options]

Reads photos waiting on the site with your local Claude Code and uploads the results.

Options:
  --site URL          The site, e.g. https://photo2pgn.example.org (or PGN_SITE)
  --token-file PATH   File holding the worker token (default: PGN_WORKER_TOKEN)
  --once              Read what is waiting now, then exit (default: keep watching)
  --list              Only list waiting jobs
  --interval SECONDS  How often to check when watching (default 20)
  --model NAME        Model for claude --model (default opus)
  --effort LEVEL      low, medium, high, xhigh or max (default high)
  --timeout SECONDS   Give up on one reading after this long (default 600)
  --claude PATH       The claude executable (default claude)
  --allow-api-key     Allow readings billed to an API key (default: refuse)
  -h, --help          Show this help
`;

const { values: opt } = parseArgs({
  options: {
    site: { type: "string" },
    "token-file": { type: "string" },
    once: { type: "boolean", default: false },
    list: { type: "boolean", default: false },
    interval: { type: "string", default: "20" },
    model: { type: "string", default: "opus" },
    effort: { type: "string", default: "high" },
    timeout: { type: "string", default: "600" },
    claude: { type: "string", default: "claude" },
    "allow-api-key": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (opt.help) {
  process.stdout.write(HELP);
  process.exit(0);
}

const site = (opt.site ?? process.env.PGN_SITE ?? "").replace(/\/+$/, "");
const token = (opt["token-file"] ? readFileSync(opt["token-file"], "utf8") : process.env.PGN_WORKER_TOKEN ?? "").trim();
if (!site || !token) {
  process.stderr.write("Need --site (or PGN_SITE) and a worker token (PGN_WORKER_TOKEN or --token-file).\n\n" + HELP);
  process.exit(2);
}
const workerId = `${hostname()}-${process.pid}`;
// claude runs in a temp directory, so a relative path must be made absolute.
const claudeBin = opt.claude.includes("/") ? resolve(opt.claude) : opt.claude;

class FatalError extends Error {}

function log(...args) {
  process.stdout.write(`${new Date().toISOString().slice(11, 19)} ${args.join(" ")}\n`);
}

async function api(method, path, body) {
  const res = await fetch(`${site}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: { message: text.slice(0, 200) } };
  }
  if (res.status === 401) throw new FatalError("The site refused the worker token.");
  return { status: res.status, data };
}

/** Run claude on one claimed job. Resolves with { extraction, usage }. */
function readWithClaude(claim) {
  const args = [
    "-p",
    "--safe-mode",
    "--tools",
    "",
    "--no-session-persistence",
    "--model",
    opt.model,
    "--effort",
    opt.effort,
    "--system-prompt",
    claim.systemPrompt,
    "--json-schema",
    JSON.stringify(claim.schema),
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
  ];
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;

  return new Promise((resolve, reject) => {
    const child = spawn(claudeBin, args, { env, cwd: tmpdir(), stdio: ["pipe", "pipe", "pipe"] });
    let buffer = "";
    let stderr = "";
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(reject, Object.assign(new Error(`claude took longer than ${opt.timeout}s`), { retry: true }));
    }, Number(opt.timeout) * 1000);

    child.on("error", (err) =>
      finish(reject, new FatalError(`Could not run ${opt.claude}: ${err.message}. Is Claude Code installed and on PATH?`)),
    );
    child.stderr.on("data", (d) => (stderr += d));
    child.stdout.on("data", (d) => {
      buffer += d;
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (ev.type === "system" && ev.subtype === "init") {
          const source = ev.apiKeySource ?? "none";
          if (source !== "none" && !opt["allow-api-key"]) {
            child.kill("SIGTERM");
            finish(
              reject,
              new FatalError(
                `claude is using an API key (${source}), which is billed per token. Log in with your subscription (claude, then /login), or pass --allow-api-key.`,
              ),
            );
          }
        }
        if (ev.type === "result") {
          if (ev.is_error || !ev.structured_output) {
            finish(reject, Object.assign(new Error(`claude: ${ev.subtype ?? "error"} ${String(ev.result ?? "").slice(0, 200)}`), { retry: true }));
          } else {
            const usage = ev.usage ?? {};
            const model = Object.keys(ev.modelUsage ?? {})[0] ?? opt.model;
            finish(resolve, {
              extraction: ev.structured_output,
              usage: {
                model: `${model} (local)`,
                inputTokens: (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
                outputTokens: usage.output_tokens ?? 0,
              },
            });
          }
        }
      }
    });
    child.on("close", (code) => {
      finish(reject, Object.assign(new Error(`claude exited (${code}) without an answer. ${stderr.trim().slice(0, 300)}`), { retry: true }));
    });

    const message = {
      type: "user",
      message: {
        role: "user",
        content: [
          ...claim.images.map((img) => ({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } })),
          { type: "text", text: claim.userText },
        ],
      },
    };
    child.stdin.end(JSON.stringify(message) + "\n");
  });
}

async function processJob(job) {
  const claim = await api("POST", `/api/worker/jobs/${encodeURIComponent(job.id)}/claim`, { workerId });
  if (claim.status !== 200) {
    log(`skip ${job.id}: ${claim.data.error?.message ?? claim.status}`);
    return;
  }
  const { leaseToken } = claim.data;
  const started = Date.now();
  log(`read ${job.id} (${claim.data.images.length} page${claim.data.images.length > 1 ? "s" : ""})…`);
  try {
    const { extraction, usage } = await readWithClaude(claim.data);
    const res = await api("POST", `/api/worker/jobs/${encodeURIComponent(job.id)}/result`, { leaseToken, extraction, usage });
    if (res.status === 200) {
      const moves = extraction.rows?.length ?? 0;
      log(`done ${job.id}: ${moves} moves in ${Math.round((Date.now() - started) / 1000)}s`);
      return;
    }
    const issues = (res.data.issues ?? []).map((i) => `${i.path}: ${i.message}`).join("; ");
    throw Object.assign(new Error(`site refused the reading: ${res.data.error?.message ?? res.status} ${issues}`), { retry: true });
  } catch (err) {
    log(`fail ${job.id}: ${err.message}`);
    await api("POST", `/api/worker/jobs/${encodeURIComponent(job.id)}/result`, {
      leaseToken,
      error: { message: err instanceof FatalError ? "The reader is not set up correctly." : err.message },
      retry: err instanceof FatalError || Boolean(err.retry),
    }).catch(() => {});
    if (err instanceof FatalError) throw err;
  }
}

let stopping = false;
process.on("SIGINT", () => {
  if (stopping) process.exit(130);
  stopping = true;
  log("stopping after the current job (Ctrl-C again to quit now)");
});

async function main() {
  for (;;) {
    let jobs = [];
    try {
      const { status, data } = await api("GET", "/api/worker/jobs");
      if (status === 404) throw new FatalError("The site has no worker endpoints (is PGN_WORKER_TOKEN set there?).");
      if (status !== 200) throw new Error(`the site answered ${status}: ${data.error?.message ?? ""}`);
      jobs = data.jobs ?? [];
    } catch (err) {
      // Keep watching through network blips; stop on setup problems.
      if (err instanceof FatalError || opt.once || opt.list) throw err;
      log(`cannot reach the site: ${err.message}`);
    }
    if (opt.list) {
      for (const j of jobs) log(`${j.id}  ${j.createdAt}  pages=${j.imageCount}  attempts=${j.attempts}`);
      log(`${jobs.length} waiting`);
      return;
    }
    for (const job of jobs) {
      if (stopping) return;
      await processJob(job);
    }
    if (opt.once || stopping) return;
    await new Promise((r) => setTimeout(r, Number(opt.interval) * 1000));
    if (stopping) return;
  }
}

main().catch((err) => {
  process.stderr.write(`pgn-worker: ${err.message}\n`);
  process.exit(1);
});
