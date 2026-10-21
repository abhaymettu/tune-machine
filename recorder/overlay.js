// Drawn on top of the engine player's frame: a piano roll of the tune in the band above the
// machine, lit at the moment each logged bar hit happens (green within tolerance, red outside),
// the true attempt count, and the closing caption. Every time it uses comes from the reel's
// recorded scores, which came from the engine's events.
const TOL = 0.025;
const BG = "#0b0d12";
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const SANS = "ui-sans-serif, system-ui, sans-serif";

export function drawOverlay(g, player, frame) {
  const reel = player.reel, tm = reel.tuneMachine;
  if (!tm) return;
  const { seg, simTime } = player.at(frame);
  const { width, height } = g.canvas;
  const shown = tm.scores[seg.attempt];
  const world = player.tl.first.level.world;
  const x0 = player.ox, w = world.width * player.scale;
  const top = player.oy - world.height * player.scale + 6, bandH = 62;
  const span = tm.tune.notes.at(-1).t + 0.75; // the roll covers the tune, not the whole run
  const X = (t) => x0 + (Math.min(t, span) / span) * w;
  const live = seg.kind === "ghost" || seg.kind === "winner";
  const now = seg.kind === "outro" ? Infinity : live ? simTime : -1;

  const midis = tm.tune.notes.map((n) => n.midi);
  const lo = Math.min(...midis), hi = Math.max(...midis);
  const blockH = 18, blockW = 34;
  const Y = (m) => top + (hi === lo ? (bandH - blockH) / 2 : ((hi - m) / (hi - lo)) * (bandH - blockH));

  g.save();
  g.strokeStyle = "rgba(139,147,163,.25)";
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(x0, top + bandH + 4.5); g.lineTo(x0 + w, top + bandH + 4.5); g.stroke();
  g.font = `500 11px ${MONO}`;
  g.textBaseline = "middle";
  g.textAlign = "center";
  for (const n of shown.notes) {
    const x = X(n.t) - blockW / 2, y = Y(n.midi);
    const struck = n.hit && n.hit.t <= now;
    const missed = !n.hit && seg.kind === "outro";
    g.fillStyle = struck ? (n.ok ? "#3fb36b" : "#d9534f") : "rgba(89,96,110,.35)";
    g.strokeStyle = missed ? "#d9534f" : struck ? "transparent" : "#59606e";
    g.fillRect(x, y, blockW, blockH);
    g.strokeRect(x + 0.5, y + 0.5, blockW - 1, blockH - 1);
    g.fillStyle = struck ? "#0b0d12" : "#a3abba";
    g.fillText(n.pitch, x + blockW / 2, y + blockH / 2 + 0.5);
    if (struck) {
      g.fillStyle = "#f3f5f9";
      g.fillRect(Math.round(X(n.hit.t)) - 1, y - 4, 2, blockH + 8);
    }
  }
  for (const e of shown.extras) {
    if (e.t > now || e.t > span) continue;
    g.fillStyle = "#d9534f";
    g.fillRect(Math.round(X(e.t)) - 1, top, 2, bandH);
  }
  if (live) {
    g.fillStyle = "rgba(232,235,241,.55)";
    g.fillRect(Math.round(X(simTime)), top - 2, 1, bandH + 8);
  }
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  g.fillStyle = "#6c7486";
  g.fillText(`green: within ${Math.round(TOL * 1000)} ms of the score`, x0, top + bandH + 18);

  if (seg.kind !== "intro") {
    g.fillStyle = BG;
    g.fillRect(width - 420, 28, 420, 34);
    g.font = `500 18px ${MONO}`;
    g.textAlign = "right";
    g.fillStyle = seg.kind === "ghost" ? "#8b93a3" : "#e8ebf1";
    g.fillText(`design ${shown.index} of ${tm.totalAttempts}${seg.kind === "ghost" ? `   ×${seg.speed.toFixed(0)}` : ""}`, width - 40, 52);
  }

  if (seg.kind === "outro") {
    const s = tm.scores[reel.winner];
    const n = s.notes.length, played = s.notes.filter((x) => x.hit).length;
    const worst = s.worst === null ? "no notes played" : `worst timing error ${Math.round(s.worst * 1000)} ms`;
    g.fillStyle = BG;
    g.fillRect(0, height / 2 - 64, width, 112);
    g.textAlign = "center";
    g.fillStyle = "#f3f5f9";
    g.font = `600 30px ${SANS}`;
    const extra = s.extras.length ? `, ${s.extras.length} extra hit${s.extras.length === 1 ? "" : "s"}` : "";
    g.fillText(`${played} of ${n} notes struck, ${s.onTime} on time, ${worst}${extra}`, width / 2, height / 2 - 14);
    g.font = `400 18px ${SANS}`;
    g.fillStyle = "#a3abba";
    const verdict = tm.passed ? `passed on design ${tm.bestAttempt} of ${tm.totalAttempts}` : `closest of ${tm.totalAttempts} designs; did not pass`;
    g.fillText(`${verdict}  ·  every note is a logged marble hit, none placed by hand`, width / 2, height / 2 + 22);
  }
  g.restore();
}
