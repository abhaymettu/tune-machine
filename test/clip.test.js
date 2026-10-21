// Records a real mp4 from the fixture winning level: headless Chromium plus ffmpeg, a few seconds.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runPipeline } from "../src/pipeline.js";
import { buildTimeline, FPS, synthWav } from "../src/engine.js";
import { clipSeconds, soundsFor } from "../src/reel.js";
import { StubModel } from "../src/model.js";
import { fixtureTune, shiftedLevel, tmp, winningLevel } from "./helpers.js";

test("a clip is produced from the fixture winning level, with audio at the logged hit times", async () => {
  const dir = tmp();
  const model = new StubModel([shiftedLevel(), winningLevel()]);
  const { report, reel } = await runPipeline(model, { outDir: dir, tune: fixtureTune(), maxAttempts: 3 });
  assert.equal(report.passed, true);
  assert.equal(report.bestAttempt, 2);
  assert.equal(model.calls, 2);
  const mp4 = join(dir, "clip.mp4");
  assert.ok(existsSync(mp4));
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", mp4]).toString());
  const video = probe.streams.find((s) => s.codec_type === "video");
  const audio = probe.streams.find((s) => s.codec_type === "audio");
  assert.equal(video.width, 1280);
  assert.equal(video.height, 720);
  assert.ok(audio, "the clip has an audio track");
  assert.ok(Math.abs(Number(probe.format.duration) - report.clip.seconds) < 0.1);

  // The WAV that was muxed: removing any one sound changes it first at that sound's start sample,
  // and that sample is the winner segment's start plus the logged hit time.
  const wav = readFileSync(join(dir, "clip.wav"));
  const rate = wav.readUInt32LE(24);
  const sounds = soundsFor(reel);
  assert.ok(wav.equals(synthWav(sounds, clipSeconds(reel) + 0.5)), "clip.wav is exactly the synth of the logged hits");
  const winStart = buildTimeline(reel).segs.find((x) => x.kind === "winner").start / FPS;
  const hits = reel.attempts[reel.winner].replay.trace.events.filter((e) => e.type === "bar-hit").map((e) => e.t);
  assert.equal(sounds.length, hits.length);
  sounds.forEach((snd, k) => {
    const without = synthWav(sounds.filter((_, j) => j !== k), clipSeconds(reel) + 0.5);
    let i = 44;
    while (i < wav.length && wav[i] === without[i]) i++;
    const firstDiff = Math.floor((i - 44) / 2);
    const expected = Math.round((winStart + hits[k]) * rate);
    assert.ok(firstDiff - expected >= 0 && firstDiff - expected <= 2, `note ${k + 1}: differs at sample ${firstDiff}, hit is at ${expected}`);
  });
  for (const f of ["tune.json", "reel.json", "result.json", "calls.jsonl", "design-1.level.json", "design-2.level.json", "still-end.png"]) assert.ok(existsSync(join(dir, f)), f);
});
