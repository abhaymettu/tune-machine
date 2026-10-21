// Turns a finished loop into a goldberg-reel/1 the engine's renderer can play: earlier valid
// attempts as fast ghosts, the closest attempt as the winner at real speed. Each attempt carries
// the replay that was scored, so the clip never re-simulates. The extra `tuneMachine` field
// holds the tune and per-note scores for the piano roll overlay; the engine's player ignores it.
import { buildTimeline, FPS } from "./engine.js";

export function makeReel({ tune, attempts, best, passed }) {
  if (best === null || best === undefined || !attempts[best]?.ok) throw new Error("makeReel: no valid attempt to show");
  const shown = attempts.slice(0, best + 1).filter((a) => a.ok && a.replay);
  const winner = shown.length - 1;
  return {
    schema: "goldberg-reel/1",
    title: tune.title,
    goal: null,
    goalText: `the agent wrote this tune: ${tune.notes.map((n) => n.pitch).join(" ")}`,
    winner,
    attempts: shown.map((a) => ({ index: a.index, note: noteFor(a), met: a.score.pass, replay: a.replay })),
    tuneMachine: {
      tune,
      totalAttempts: attempts.length,
      bestAttempt: attempts[best].index,
      passed: Boolean(passed),
      scores: shown.map((a) => ({ index: a.index, notes: a.score.notes, extras: a.score.extras, total: a.score.total, worst: a.score.worst, onTime: a.score.onTime, pass: a.score.pass })),
    },
  };
}

function noteFor(a) {
  const s = a.score, n = s.notes.length;
  const worst = s.worst === null ? "" : `, worst ${Math.round(s.worst * 1000)} ms`;
  return `${s.onTime} of ${n} notes on time${worst}${s.missing ? `, ${s.missing} missing` : ""}${s.extras.length ? `, ${s.extras.length} extra` : ""}`;
}

/**
 * The sounds the clip carries, in clip seconds: every bar-hit the winning run logged, placed at
 * the winner segment's start plus the event's own simulation time. Same rule as the engine
 * player's audioEvents(); the recorder checks the two agree before it writes audio.
 */
export function soundsFor(reel) {
  const { segs } = buildTimeline(reel);
  const out = [];
  for (const seg of segs.filter((s) => s.kind === "winner")) {
    const rp = reel.attempts[seg.attempt].replay;
    const end = seg.simStart + (seg.frames / FPS) * seg.speed;
    for (const e of rp.trace.events) {
      if (e.t < seg.simStart || e.t >= end) continue;
      if (e.type === "bell-rung" || e.type === "bar-hit") out.push({ time: seg.start / FPS + (e.t - seg.simStart) / seg.speed, type: e.type, freq: e.freq ?? null, speed: e.speed });
    }
  }
  return out;
}

export function clipSeconds(reel) {
  return buildTimeline(reel).total / FPS;
}
