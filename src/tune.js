// A tune is a short list of notes with onset times, in simulation seconds.
//   { "title": "Evening bells", "notes": [ { "pitch": "C5", "t": 1.5 }, ... ] }
import { parsePitch } from "./engine.js";

export const TUNE_RULES = {
  minNotes: 4,
  maxNotes: 8,
  lowest: "C4",
  highest: "C7",
  earliest: 1.0, // seconds; leaves time for the first marble to fall
  latest: 9.0,
  minGap: 0.25, // between any two onsets
};

/** { ok: true, tune } with each note's midi and canonical name filled in, or { ok: false, errors }. */
export function validateTune(input, rules = TUNE_RULES) {
  const errors = [];
  if (!input || typeof input !== "object" || !Array.isArray(input.notes)) return { ok: false, errors: ["a tune needs a notes list"] };
  const lo = parsePitch(rules.lowest).midi, hi = parsePitch(rules.highest).midi;
  const n = input.notes.length;
  if (n < rules.minNotes || n > rules.maxNotes) errors.push(`a tune has ${rules.minNotes} to ${rules.maxNotes} notes, this one has ${n}`);
  const notes = input.notes.map((raw, i) => {
    const p = parsePitch(raw?.pitch);
    if (!p) errors.push(`note ${i + 1}: pitch ${JSON.stringify(raw?.pitch)} is not a note name like "C5" or "F#4"`);
    else if (p.midi < lo || p.midi > hi) errors.push(`note ${i + 1}: ${p.name} is outside ${rules.lowest} to ${rules.highest}`);
    const t = raw?.t;
    if (typeof t !== "number" || !Number.isFinite(t)) errors.push(`note ${i + 1}: t must be a number of seconds`);
    else if (t < rules.earliest || t > rules.latest) errors.push(`note ${i + 1}: t = ${t} is outside ${rules.earliest} to ${rules.latest} s`);
    return { pitch: p?.name ?? String(raw?.pitch), midi: p?.midi ?? null, t: typeof t === "number" ? round6(t) : t };
  });
  const times = notes.map((x) => x.t).filter((t) => typeof t === "number").sort((a, b) => a - b);
  for (let i = 1; i < times.length; i++) {
    if (times[i] - times[i - 1] < rules.minGap - 1e-9) {
      errors.push(`onsets ${times[i - 1]} and ${times[i]} are closer than ${rules.minGap} s`);
      break;
    }
  }
  if (errors.length) return { ok: false, errors };
  notes.sort((a, b) => a.t - b.t || a.midi - b.midi);
  return { ok: true, tune: { title: typeof input.title === "string" ? input.title.slice(0, 60) : "untitled", notes } };
}

export const round6 = (x) => Math.round(x * 1e6) / 1e6;
