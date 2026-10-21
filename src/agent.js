// The agent loop. Call 1: the model writes a short tune. Calls 2..N+1: the model writes a whole
// goldberg-level/1 machine, the engine simulates it, and the model gets back each note's timing
// error measured from the engine's bar-hit events. The loop stops when the run passes or after
// maxAttempts designs, and keeps every attempt so the closest one can be shipped if none passes.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ENGINE_ROOT, onsets, simulate, validateLevel } from "./engine.js";
import { extractJson } from "./model.js";
import { describeScore, scoreRun, SCORING } from "./score.js";
import { TUNE_RULES, validateTune } from "./tune.js";

export const WORLD = { width: 20, height: 12 };
export const CEILING = 10.5; // the top band of the board is kept clear for the piano roll in the clip
export const LIMITS = { parts: 40, marbles: 16 };

export const TUNE_SYSTEM = `You compose very short melodies that a marble machine will play on xylophone bars.
Reply with one JSON object and nothing else.`;

export function tunePrompt(rules = TUNE_RULES) {
  return `Write a short, singable tune of ${rules.minNotes} to ${rules.maxNotes} notes.

Rules:
- pitches are note names from ${rules.lowest} to ${rules.highest}, like "C5", "F#5", "Bb4"
- each note has an onset time t in seconds, from ${rules.earliest} to ${rules.latest}
- any two onsets are at least ${rules.minGap} s apart; a steady pulse with a little rhythm reads best
- give it a short title

Reply exactly in this shape:
{"title": "...", "notes": [{"pitch": "E5", "t": 1.5}, {"pitch": "G5", "t": 2.0}]}`;
}

export function designSystem() {
  const schema = readFileSync(join(ENGINE_ROOT, "docs", "level-schema.md"), "utf8");
  return `You design marble machines for a deterministic 2D physics engine so that they play a given tune.
Every note must be a real marble striking a real bar of that pitch at the note's onset time.
Reply with one goldberg-level/1 JSON object and nothing else.

The engine's level format, generated from its validator:

${schema}

House rules for this task:
- The world is set for you (${WORLD.width} m wide, ${WORLD.height} m tall, duration fixed). Any "world" or "goal" you send is ignored.
- Keep every part at or below y = ${CEILING} (a hopper's top is its y plus its height). The band above is reserved.
- At most ${LIMITS.parts} parts and ${LIMITS.marbles} marbles in total. Hoppers release marbles through timed gates; use "floor" so marbles land.
- A bar sounds only when hit faster than its minSpeed. A marble that bounces onto a second bar plays a second, unwanted note.

Physics notes, measured in this engine: g = 9.8 m/s^2, fixed step 1/240 s, so every event time is a multiple of 1/240 s.
Example: a one-marble hopper (default size) with its gate at y = 9, over a bar at y = 5 whose centre is 0.1 m right of the
hopper's centre, tilted -20 degrees: the marble hits the bar 0.883 s after the gate opens. Free fall from rest over height h takes about sqrt(2h/g).
Moving a gate's open time by d moves that marble's hit by d, as long as nothing else about its path changes.`;
}

export function designPrompt(tune, history = []) {
  const notes = tune.notes.map((n, i) => `  ${i + 1}. ${n.pitch} at t = ${n.t.toFixed(3)} s`).join("\n");
  let p = `The tune "${tune.title}":\n${notes}\n\nThe simulation runs for ${duration(tune).toFixed(2)} s.\n`;
  p += `A run passes when every note is played by a bar hit of its pitch, there are no extra bar hits, and the summed timing error is under ${(SCORING.perNote * tune.notes.length * 1000).toFixed(0)} ms.\n`;
  const last = history.at(-1);
  if (!last) return p + "\nDesign the machine.";
  p += `\nThis is design attempt ${history.length + 1}. Your previous attempt (${history.length}) was:\n${JSON.stringify(last.level)}\n\nWhat the engine measured for it:\n${feedback(last)}\n`;
  const best = bestIndex(history);
  if (best !== null && best !== history.length - 1) {
    p += `\nYour best attempt so far is attempt ${best + 1} (total error ${history[best].score.total.toFixed(3)} s):\n${JSON.stringify(history[best].level)}\n`;
  }
  return p + "\nSend the full revised level.";
}

function feedback(a) {
  if (!a.ok) return `The level was rejected before simulation:\n- ${a.errors.join("\n- ")}`;
  const out = a.outOfBounds.length ? `\nMarbles that left the board: ${a.outOfBounds.join(", ")}` : "";
  return describeScore(a.score) + out;
}

export const duration = (tune) => Math.round((tune.notes.at(-1).t + 2.5) * 100) / 100;

/** Put the model's level into this task's frame and check the house rules. */
export function prepareLevel(raw, tune) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: ["the reply had no JSON level object"] };
  const level = { ...raw, schema: "goldberg-level/1", world: { ...WORLD, duration: duration(tune) } };
  delete level.goal;
  const v = validateLevel(level);
  if (!v.ok) return { ok: false, errors: v.errors, level };
  const errors = [];
  if (v.level.parts.length > LIMITS.parts) errors.push(`${v.level.parts.length} parts; the limit is ${LIMITS.parts}`);
  let marbles = 0;
  for (const p of v.level.parts) {
    if (p.type === "hopper") marbles += p.marbles;
    if (p.type === "marble" || p.type === "ball") marbles += 1;
    const top = topOf(p);
    if (top > CEILING + 1e-9) errors.push(`${p.id} reaches y = ${+top.toFixed(3)}, above the ${CEILING} ceiling`);
  }
  if (marbles > LIMITS.marbles) errors.push(`${marbles} marbles; the limit is ${LIMITS.marbles}`);
  return errors.length ? { ok: false, errors, level } : { ok: true, level };
}

function topOf(p) {
  switch (p.type) {
    case "hopper": return p.y + p.height;
    case "ramp": case "floor": return Math.max(p.from?.[1] ?? 0, p.to?.[1] ?? 0);
    case "bar": return p.y + p.height / 2 + (p.width / 2) * Math.abs(Math.sin((p.angle * Math.PI) / 180));
    case "ball": case "marble": return p.y + p.radius;
    case "lever": return p.y + p.length / 2;
    case "domino": return p.y + p.height;
    case "bell": return p.y + p.height / 2;
    default: return p.y ?? 0;
  }
}

/** Simulate one design and score it. Keeps the replay so the clip shows exactly this run. */
export function runAttempt(raw, tune) {
  const prep = prepareLevel(raw, tune);
  if (!prep.ok) return { ok: false, errors: prep.errors, level: prep.level ?? raw, score: null };
  const { trace, replay } = simulate(prep.level, { seed: 1 });
  const hits = onsets(trace);
  const score = scoreRun(tune, hits);
  const outOfBounds = trace.events.filter((e) => e.type === "out-of-bounds").map((e) => e.part);
  return { ok: true, errors: [], level: prep.level, hits, score, outOfBounds, replay };
}

export function bestIndex(attempts) {
  let best = null;
  attempts.forEach((a, i) => {
    if (a.ok && (best === null || a.score.total < attempts[best].score.total)) best = i;
  });
  return best;
}

/** Ask for a tune, retrying once with the validator's errors. */
export async function writeTune(model, { log = () => {} } = {}) {
  let prompt = tunePrompt();
  for (let round = 1; round <= 2; round++) {
    const { text } = await model.ask({ system: TUNE_SYSTEM, prompt });
    log({ step: "tune", round, prompt, reply: text });
    const v = validateTune(extractJson(text));
    if (v.ok) return v.tune;
    prompt = `${tunePrompt()}\n\nYour last reply was rejected:\n- ${v.errors.join("\n- ")}\nFix it.`;
  }
  throw new Error("the model did not write a valid tune in two tries");
}

/** Design, simulate, score, repeat. Returns every attempt and the index of the closest one. */
export async function designLoop(model, tune, { maxAttempts = 5, log = () => {} } = {}) {
  const system = designSystem();
  const attempts = [];
  for (let k = 1; k <= maxAttempts; k++) {
    const prompt = designPrompt(tune, attempts);
    let text, attempt;
    try {
      ({ text } = await model.ask({ system, prompt }));
      attempt = runAttempt(extractJson(text), tune);
    } catch (e) {
      if (/claude call/.test(e.message)) throw e;
      attempt = { ok: false, errors: [e.message], level: null, score: null };
    }
    attempt.index = k;
    attempts.push(attempt);
    log({ step: "design", attempt: k, prompt, reply: text, ok: attempt.ok, errors: attempt.errors, score: attempt.score && summary(attempt.score) });
    if (attempt.ok && attempt.score.pass) break;
  }
  const best = bestIndex(attempts);
  return { attempts, best, passed: best !== null && attempts[best].score.pass };
}

export const summary = (s) => ({ total: s.total, worst: s.worst, onTime: s.onTime, notes: s.notes.length, missing: s.missing, extras: s.extras.length, pass: s.pass });
