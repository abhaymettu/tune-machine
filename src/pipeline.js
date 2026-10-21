// One full run: tune, design loop, reel, clip. Everything lands in one run folder.
import { appendFileSync, copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { designLoop, summary, writeTune } from "./agent.js";
import { makeReel } from "./reel.js";
import { recordClip } from "./record.js";

export async function runPipeline(model, { outDir, maxAttempts = 5, tune: givenTune = null, clip = true, clipPath = null, say = () => {} }) {
  mkdirSync(outDir, { recursive: true });
  const logFile = join(outDir, "calls.jsonl");
  const log = (entry) => appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
  const started = Date.now();

  const tune = givenTune ?? (await writeTune(model, { log }));
  writeFileSync(join(outDir, "tune.json"), JSON.stringify(tune, null, 2) + "\n");
  say(`tune "${tune.title}": ${tune.notes.map((n) => `${n.pitch}@${n.t}`).join(" ")}`);

  const result = await designLoop(model, tune, {
    maxAttempts,
    log: (e) => { log(e); say(`design ${e.attempt}: ${e.ok ? `total ${e.score.total} s, ${e.score.onTime}/${e.score.notes} on time, ${e.score.missing} missing, ${e.score.extras} extra${e.score.pass ? ", PASS" : ""}` : `rejected: ${e.errors.slice(0, 2).join("; ")}`}`); },
  });
  for (const a of result.attempts) {
    writeFileSync(join(outDir, `design-${a.index}.level.json`), JSON.stringify(a.level, null, 2) + "\n");
  }
  const report = {
    tune,
    passed: result.passed,
    bestAttempt: result.best === null ? null : result.attempts[result.best].index,
    attempts: result.attempts.map((a) => ({ index: a.index, ok: a.ok, errors: a.errors, score: a.score && summary(a.score), notes: a.score?.notes, extras: a.score?.extras })),
    modelCalls: model.calls,
    seconds: (Date.now() - started) / 1000,
  };
  if (result.best === null) {
    writeFileSync(join(outDir, "result.json"), JSON.stringify(report, null, 2) + "\n");
    throw new Error("no design simulated; see calls.jsonl");
  }
  const reel = makeReel({ tune, ...result });
  writeFileSync(join(outDir, "reel.json"), JSON.stringify(reel));
  if (clip) {
    const mp4 = join(outDir, "clip.mp4");
    const rec = await recordClip(reel, mp4, { stills: [{ at: 0.9 * reel.attempts.length, path: join(outDir, "still-early.png") }, { at: 9999, path: join(outDir, "still-end.png") }] });
    report.clip = { path: mp4, seconds: rec.seconds, frames: rec.frames, sounds: rec.sounds.map((s) => +s.time.toFixed(6)) };
    if (clipPath) { copyFileSync(mp4, clipPath); report.clip.copiedTo = clipPath; }
  }
  report.seconds = (Date.now() - started) / 1000;
  writeFileSync(join(outDir, "result.json"), JSON.stringify(report, null, 2) + "\n");
  return { report, reel, result };
}
