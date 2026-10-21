// The model behind the agent. ClaudeModel runs the local `claude` CLI in print mode on the
// user's own login: no tools, no MCP servers, no saved session, a small budget cap, an empty
// temporary folder as its working directory, and a pause between calls. Tests use StubModel.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export function claudeBinary() {
  if (process.env.TUNE_CLAUDE) return process.env.TUNE_CLAUDE;
  const local = join(homedir(), ".local", "bin", "claude");
  return existsSync(local) ? local : "claude";
}

export class ClaudeModel {
  constructor({ model = "sonnet", budgetUsd = 0.5, timeoutMs = 300_000, pauseMs = 4000, bin = claudeBinary() } = {}) {
    Object.assign(this, { model, budgetUsd, timeoutMs, pauseMs, bin });
    this.calls = 0;
    this.last = 0;
  }

  args(system) {
    return ["-p", "--model", this.model, "--output-format", "json", "--tools", "", "--strict-mcp-config",
      "--mcp-config", '{"mcpServers":{}}', "--no-session-persistence", "--max-budget-usd", String(this.budgetUsd),
      "--system-prompt", system];
  }

  async ask({ system, prompt }) {
    const wait = this.last + this.pauseMs - Date.now();
    if (this.calls > 0 && wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.calls++;
    const cwd = mkdtempSync(join(tmpdir(), "tune-machine-"));
    const started = Date.now();
    const { code, stdout, stderr } = await run(this.bin, this.args(system), prompt, cwd, this.timeoutMs);
    this.last = Date.now();
    let parsed;
    try { parsed = JSON.parse(stdout); } catch { parsed = null; }
    if (code !== 0 || !parsed || parsed.is_error) {
      const why = parsed?.result ?? parsed?.subtype ?? stderr.trim().slice(-400) ?? `exit ${code}`;
      throw new Error(`claude call failed (exit ${code}): ${why}`);
    }
    return { text: String(parsed.result ?? ""), meta: { model: this.model, seconds: (Date.now() - started) / 1000, turns: parsed.num_turns ?? null } };
  }
}

function run(bin, args, input, cwd, timeoutMs) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { p.kill("SIGTERM"); reject(new Error(`claude call timed out after ${timeoutMs / 1000} s`)); }, timeoutMs);
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    p.stdin.end(input);
  });
}

/** Answers from a list (or a function of the request), and remembers every request it saw. */
export class StubModel {
  constructor(replies) {
    this.replies = replies;
    this.requests = [];
    this.calls = 0;
  }

  async ask(req) {
    this.requests.push(req);
    const i = this.calls++;
    const r = typeof this.replies === "function" ? await this.replies(req, i) : this.replies[i];
    if (r === undefined) throw new Error(`StubModel has no reply for call ${i + 1}`);
    if (r instanceof Error) throw r;
    return { text: typeof r === "string" ? r : JSON.stringify(r), meta: { model: "stub" } };
  }
}

/** The first JSON object in a reply, fenced or not. Null if there is none. */
export function extractJson(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  for (const candidate of [fence?.[1], text]) {
    if (!candidate) continue;
    const start = candidate.indexOf("{");
    if (start < 0) continue;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < candidate.length; i++) {
      const c = candidate[i];
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        try { return JSON.parse(candidate.slice(start, i + 1)); } catch { break; }
      }
    }
  }
  return null;
}
