import test from "node:test";
import assert from "node:assert/strict";
import { validateTune } from "../src/tune.js";

const notes = (...pairs) => pairs.map(([pitch, t]) => ({ pitch, t }));

test("a valid tune is sorted by time and pitches are made canonical", () => {
  const v = validateTune({ title: "x", notes: notes(["G5", 2], ["Bb4", 1], ["C5", 3], ["E5", 4]) });
  assert.equal(v.ok, true);
  assert.deepEqual(v.tune.notes.map((n) => [n.pitch, n.midi, n.t]), [["A#4", 70, 1], ["G5", 79, 2], ["C5", 72, 3], ["E5", 76, 4]]);
});

test("too few notes, bad pitches, out-of-range times and crowded onsets are each reported", () => {
  assert.match(validateTune({ notes: notes(["C5", 1], ["E5", 2]) }).errors[0], /4 to 8 notes/);
  const v = validateTune({ notes: notes(["H5", 1], ["C2", 2], ["E5", 0.2], ["G5", 3], ["C6", 3.1]) });
  assert.equal(v.ok, false);
  const all = v.errors.join("\n");
  assert.match(all, /"H5" is not a note name/);
  assert.match(all, /C2 is outside/);
  assert.match(all, /t = 0.2 is outside/);
  assert.match(all, /closer than 0.25 s/);
  assert.equal(validateTune(null).ok, false);
});
