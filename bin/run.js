#!/usr/bin/env node
// tune-machine [--attempts 5] [--model sonnet] [--tune tune.json] [--no-clip] [--out out]
// The model writes a tune (unless --tune is given), then designs machines until one plays it
// on time or the attempts run out. Writes out/run-<stamp>/ and copies the clip to out/clip.mp4.
import { mkdirSync, readFileSync, statfsSync } from "node:fs";
import { join, resolve } from "node:path";
import { ROOT } from "../src/engine.js";
import { ClaudeModel } from "../src/model.js";
import { runPipeline } from "../src/pipeline.js";
import { validateTune } from "../src/tune.js";

const args = process.argv.slice(2);
const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const out = resolve(opt("--out", join(ROOT, "out")));
const attempts = Number(opt("--attempts", 5));
if (!(attempts >= 1 && attempts <= 8)) { console.error("--attempts must be 1 to 8"); process.exit(2); }

const fs = statfsSync("/");
const freeGiB = (fs.bavail * fs.bsize) / 2 ** 30;
if (freeGiB < 30) { console.error(`only ${freeGiB.toFixed(1)} GiB free on /; stopping (needs 30)`); process.exit(4); }

let tune = null;
if (opt("--tune")) {
  const v = validateTune(JSON.parse(readFileSync(opt("--tune"), "utf8")));
  if (!v.ok) { console.error(v.errors.join("\n")); process.exit(3); }
  tune = v.tune;
}

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
const runDir = join(out, `run-${stamp}`);
mkdirSync(runDir, { recursive: true });
const model = new ClaudeModel({ model: opt("--model", "sonnet") });
const { report } = await runPipeline(model, {
  outDir: runDir, maxAttempts: attempts, tune, clip: !args.includes("--no-clip"),
  clipPath: args.includes("--no-clip") ? null : join(out, "clip.mp4"), say: (s) => console.log(s),
});
console.log(JSON.stringify({ runDir, passed: report.passed, bestAttempt: report.bestAttempt, modelCalls: report.modelCalls, seconds: report.seconds, clip: report.clip?.copiedTo ?? null }));
