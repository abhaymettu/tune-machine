import test from "node:test";
import assert from "node:assert/strict";
import { buildTimeline, FPS, synthWav } from "../src/engine.js";
import { runAttempt } from "../src/agent.js";
import { clipSeconds, makeReel, soundsFor } from "../src/reel.js";
import { fixtureTune, shiftedLevel, winningLevel } from "./helpers.js";

function fixtureReel() {
  const tune = fixtureTune();
  const attempts = [{ ...runAttempt(shiftedLevel(), tune), index: 1 }, { ...runAttempt(winningLevel(), tune), index: 2 }];
  return makeReel({ tune, attempts, best: 1, passed: true });
}

test("every sound is a logged bar hit of the winning run, at winner start + its event time", () => {
  const reel = fixtureReel();
  const winSeg = buildTimeline(reel).segs.find((s) => s.kind === "winner");
  const hits = reel.attempts[reel.winner].replay.trace.events.filter((e) => e.type === "bar-hit");
  const sounds = soundsFor(reel);
  assert.equal(sounds.length, hits.length);
  sounds.forEach((s, i) => {
    assert.ok(Math.abs(s.time - (winSeg.start / FPS + hits[i].t)) < 1e-9);
    assert.equal(s.freq, hits[i].freq);
  });
  // ghost (failed) attempts are silent: nothing lands before the winner segment starts
  assert.ok(sounds.every((s) => s.time >= winSeg.start / FPS));
});

test("the synthesized WAV starts each note on the sample of its event time", () => {
  const reel = fixtureReel();
  const sounds = soundsFor(reel);
  const wav = synthWav(sounds, clipSeconds(reel) + 0.5);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  const rate = wav.readUInt32LE(24);
  const sample = (i) => wav.readInt16LE(44 + i * 2);
  for (const s of sounds) {
    const start = Math.round(s.time * rate);
    for (let i = start - 400; i < start; i++) {
      // silence before the onset, apart from the tail of an earlier note
      if (sounds.every((o) => o === s || Math.round(o.time * rate) > i || i - Math.round(o.time * rate) > rate)) assert.equal(sample(i), 0);
    }
    let peak = 0;
    for (let i = start; i < start + 200; i++) peak = Math.max(peak, Math.abs(sample(i)));
    assert.ok(peak > 1000, `no sound at ${s.time}`);
  }
});

test("the reel shows earlier valid attempts as ghosts and carries the scores for the overlay", () => {
  const reel = fixtureReel();
  assert.equal(reel.winner, 1);
  assert.deepEqual(reel.attempts.map((a) => a.index), [1, 2]);
  assert.match(reel.goalText, /the agent wrote this tune: C5 E5 G5 C6/);
  assert.equal(reel.tuneMachine.scores[1].pass, true);
  assert.equal(reel.attempts[0].note, "2 of 4 notes on time, worst 204 ms");
  assert.deepEqual(buildTimeline(reel).segs.map((s) => s.kind), ["intro", "ghost", "winner", "outro"]);
});

test("makeReel refuses a loop with no valid attempt", () => {
  assert.throws(() => makeReel({ tune: fixtureTune(), attempts: [{ ok: false, index: 1 }], best: null }), /no valid attempt/);
});
