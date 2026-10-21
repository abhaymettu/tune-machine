import test from "node:test";
import assert from "node:assert/strict";
import { describeScore, scoreRun, SCORING } from "../src/score.js";
import { validateTune } from "../src/tune.js";
import { fixtureTune } from "./helpers.js";

const hit = (t, midi, bar = `bar${midi}`, by = "m") => ({ t, midi, bar, by });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("fixture events give the exact per-note and total timing error", () => {
  const tune = fixtureTune(); // C5 1.5, E5 2.0, G5 2.5, C6 3.25
  const s = scoreRun(tune, [hit(1.504167, 72), hit(1.991667, 76), hit(2.5, 79), hit(3.3, 84)]);
  assert.deepEqual(s.notes.map((n) => n.err), [0.004167, -0.008333, 0, 0.05]);
  near(s.timing, 0.0625);
  near(s.total, 0.0625);
  assert.equal(s.worst, 0.05);
  assert.equal(s.onTime, 3);
  assert.deepEqual(s.notes.map((n) => n.ok), [true, true, true, false]);
  assert.equal(s.threshold, 0.04);
  assert.equal(s.pass, false);
});

test("a run within the threshold passes", () => {
  const s = scoreRun(fixtureTune(), [hit(1.504167, 72), hit(2.004167, 76), hit(2.504167, 79), hit(3.254167, 84)]);
  near(s.total, 0.016668);
  assert.equal(s.pass, true);
});

test("a missing note and an extra hit are charged their penalties", () => {
  const tune = fixtureTune();
  const s = scoreRun(tune, [hit(1.5, 72), hit(2.0, 76), hit(2.6, 76), hit(3.25, 84)]);
  assert.equal(s.missing, 1); // no G5
  assert.equal(s.extras.length, 1);
  assert.equal(s.extras[0].t, 2.6);
  assert.equal(s.notes[2].hit, null);
  near(s.total, SCORING.miss + SCORING.extra);
  assert.equal(s.pass, false);
});

test("hits of a wrong pitch never count for a note", () => {
  const s = scoreRun(fixtureTune(), [hit(1.5, 73), hit(2.0, 76), hit(2.5, 79), hit(3.25, 84)]);
  assert.equal(s.missing, 1);
  assert.equal(s.extras[0].midi, 73);
});

test("repeated pitches align in time order and pick the cheaper pairing", () => {
  const tune = validateTune({ notes: [{ pitch: "C5", t: 1 }, { pitch: "C5", t: 2 }, { pitch: "E5", t: 3 }, { pitch: "C5", t: 4 }] }).tune;
  // An extra C5 at 1.3 sits between notes 1 and 2; charging it as extra is cheaper than shifting every pair.
  const s = scoreRun(tune, [hit(4.01, 72), hit(1.01, 72), hit(3.0, 76), hit(1.3, 72), hit(2.02, 72)]);
  assert.deepEqual(s.notes.map((n) => n.hit?.t), [1.01, 2.02, 3.0, 4.01]);
  assert.deepEqual(s.extras.map((e) => e.t), [1.3]);
  near(s.total, 0.01 + 0.02 + 0 + 0.01 + SCORING.extra);
});

test("no hits at all means every note is missing", () => {
  const s = scoreRun(fixtureTune(), []);
  assert.equal(s.missing, 4);
  assert.equal(s.worst, null);
  near(s.total, 4 * SCORING.miss);
});

test("describeScore gives signed millisecond errors and names extras", () => {
  const text = describeScore(scoreRun(fixtureTune(), [hit(1.52, 72), hit(1.98, 76), hit(3.25, 84), hit(3.6, 84)]));
  assert.match(text, /note 1 C5 target 1\.500 s: hit at 1\.520 s .* error \+20 ms/);
  assert.match(text, /note 2 E5 .* error -20 ms/);
  assert.match(text, /note 3 G5 target 2\.500 s: MISSING/);
  assert.match(text, /EXTRA hit: .* at 3\.600 s/);
});
