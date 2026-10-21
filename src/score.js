// Scores a run against its tune. A note is matched to a bar hit of the same pitch; within one
// pitch, notes and hits are aligned in time order by a small dynamic program that may leave a note
// unmatched (MISS) or a hit unmatched (EXTRA). Total error is the sum of |hit - target| over
// matched notes, plus a fixed penalty per miss and per extra hit. All times are simulation seconds,
// taken straight from the engine's bar-hit events.
import { round6 } from "./tune.js";

export const SCORING = {
  miss: 1.0, // seconds of error charged for a note no marble played
  extra: 0.5, // seconds charged for a bar hit the tune does not have
  tolerance: 0.025, // a note is "on time" within this many seconds (green on the piano roll)
  perNote: 0.01, // pass when total error < perNote * notes, with no misses or extras
};

/**
 * @param {{ notes: { pitch: string, midi: number, t: number }[] }} tune  validated tune
 * @param {{ t: number, midi: number, bar?: string, by?: string }[]} hits  engine onsets (bar-hit events)
 */
export function scoreRun(tune, hits, opts = {}) {
  const S = { ...SCORING, ...opts };
  const notes = tune.notes.map((n, i) => ({ i, pitch: n.pitch, midi: n.midi, t: n.t, hit: null, err: null, ok: false }));
  const extras = [];
  for (const midi of [...new Set([...notes.map((n) => n.midi), ...hits.map((h) => h.midi)])]) {
    const ns = notes.filter((n) => n.midi === midi).sort((a, b) => a.t - b.t);
    const hs = hits.filter((h) => h.midi === midi).sort((a, b) => a.t - b.t);
    const { pairs, extraHits } = align(ns, hs, S);
    for (const [n, h] of pairs) {
      n.hit = { t: h.t, bar: h.bar ?? null, by: h.by ?? null };
      n.err = round6(h.t - n.t);
      n.ok = Math.abs(n.err) <= S.tolerance + 1e-9;
    }
    extras.push(...extraHits);
  }
  extras.sort((a, b) => a.t - b.t);
  const missing = notes.filter((n) => !n.hit);
  const matched = notes.filter((n) => n.hit);
  const timing = matched.reduce((s, n) => s + Math.abs(n.err), 0);
  const total = round6(timing + missing.length * S.miss + extras.length * S.extra);
  const threshold = round6(S.perNote * notes.length);
  return {
    notes,
    extras: extras.map((h) => ({ t: h.t, midi: h.midi, pitch: h.pitch ?? null, bar: h.bar ?? null, by: h.by ?? null })),
    missing: missing.length,
    timing: round6(timing),
    total,
    worst: matched.length ? round6(Math.max(...matched.map((n) => Math.abs(n.err)))) : null,
    onTime: notes.filter((n) => n.ok).length,
    threshold,
    pass: missing.length === 0 && extras.length === 0 && total < threshold,
  };
}

// Order-preserving alignment of notes to hits minimising |dt| + miss/extra penalties.
function align(ns, hs, S) {
  const N = ns.length, M = hs.length;
  const cost = Array.from({ length: N + 1 }, () => new Array(M + 1).fill(0));
  const move = Array.from({ length: N + 1 }, () => new Array(M + 1).fill(""));
  for (let i = 1; i <= N; i++) { cost[i][0] = i * S.miss; move[i][0] = "miss"; }
  for (let j = 1; j <= M; j++) { cost[0][j] = j * S.extra; move[0][j] = "extra"; }
  for (let i = 1; i <= N; i++) {
    for (let j = 1; j <= M; j++) {
      const opts = [
        [cost[i - 1][j - 1] + Math.abs(hs[j - 1].t - ns[i - 1].t), "pair"],
        [cost[i - 1][j] + S.miss, "miss"],
        [cost[i][j - 1] + S.extra, "extra"],
      ];
      const best = opts.reduce((a, b) => (b[0] < a[0] - 1e-12 ? b : a));
      cost[i][j] = best[0];
      move[i][j] = best[1];
    }
  }
  const pairs = [], extraHits = [];
  let i = N, j = M;
  while (i > 0 || j > 0) {
    const m = move[i][j];
    if (m === "pair") { pairs.push([ns[i - 1], hs[j - 1]]); i--; j--; }
    else if (m === "miss") i--;
    else { extraHits.push(hs[j - 1]); j--; }
  }
  return { pairs: pairs.reverse(), extraHits: extraHits.reverse() };
}

/** One line per note, for the agent's feedback and the logs. Errors in milliseconds, signed: + means late. */
export function describeScore(score) {
  const ms = (x) => `${x >= 0 ? "+" : ""}${Math.round(x * 1000)} ms`;
  const lines = score.notes.map((n) =>
    n.hit ? `note ${n.i + 1} ${n.pitch} target ${n.t.toFixed(3)} s: hit at ${n.hit.t.toFixed(3)} s by ${n.hit.by} on ${n.hit.bar}, error ${ms(n.err)}`
      : `note ${n.i + 1} ${n.pitch} target ${n.t.toFixed(3)} s: MISSING, no ${n.pitch} bar was hit for it`);
  for (const h of score.extras) lines.push(`EXTRA hit: ${h.pitch ?? h.midi} at ${h.t.toFixed(3)} s by ${h.by} on ${h.bar}, not in the tune`);
  lines.push(`total error ${score.total.toFixed(3)} s (pass needs under ${score.threshold.toFixed(3)} s with no missing or extra notes); worst ${score.worst === null ? "n/a" : ms(score.worst)}`);
  return lines.join("\n");
}
