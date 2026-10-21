// Records a reel to mp4: steps the recorder page frame by frame in headless Chromium (no wall
// clock), pipes PNG frames to ffmpeg, and muxes a WAV made by the engine's synth from the
// winning run's logged bar hits. Before writing audio it checks that the page's own audio list
// (the engine player's audioEvents) matches soundsFor() here, event for event.
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, extname, join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { playwright, RENDERER_DIR, ROOT, synthWav } from "./engine.js";
import { soundsFor } from "./reel.js";

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json" };

export function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  const dir = existsSync(cache) && readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-")).sort().at(-1);
  const p = dir && join(cache, dir, "chrome-headless-shell-mac-arm64", "chrome-headless-shell");
  if (!p || !existsSync(p)) throw new Error("no headless Chromium found; set CHROME_PATH");
  return p;
}

function serve(reelJson) {
  const roots = { "/engine/": RENDERER_DIR, "/": join(ROOT, "recorder") };
  const server = createServer((req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    if (path === "/reel.json") { res.writeHead(200, { "content-type": TYPES[".json"] }); return res.end(reelJson); }
    const prefix = path.startsWith("/engine/") ? "/engine/" : "/";
    const base = roots[prefix];
    const file = join(base, path === "/" ? "index.html" : path.slice(prefix.length));
    if (!file.startsWith(base) || !existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

const close = (a, b) => Math.abs(a - b) < 1e-6;

/** @returns {Promise<{ out, frames, fps, seconds, sounds, wav }>} */
export async function recordClip(reel, out, { stills = [] } = {}) {
  const expected = soundsFor(reel);
  const server = await serve(JSON.stringify(reel));
  const browser = await playwright().chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.ready === true || false, null, { timeout: 15000 });
    const { total, fps, sounds } = await page.evaluate(() => ({ total: window.reel.totalFrames, fps: window.reel.fps, sounds: window.reel.audioEvents() }));
    if (sounds.length !== expected.length || sounds.some((s, i) => !close(s.time, expected[i].time) || s.freq !== expected[i].freq)) {
      throw new Error(`audio mismatch: the player lists ${sounds.length} sounds, the logged hits give ${expected.length}`);
    }
    if (!sounds.length) throw new Error("the winning run logged no bar hits; nothing to hear");

    mkdirSync(dirname(resolve(out)), { recursive: true });
    const wav = resolve(out).replace(/\.mp4$/, "") + ".wav";
    writeFileSync(wav, synthWav(sounds, total / fps + 0.5));
    const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-i", "-",
      "-i", wav, "-c:a", "aac", "-b:a", "160k", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
      "-movflags", "+faststart", "-shortest", resolve(out)], { stdio: ["pipe", "inherit", "inherit"] });
    const done = new Promise((r, j) => ff.on("close", (c) => (c === 0 ? r() : j(new Error(`ffmpeg exited ${c}`)))));
    const want = new Map(stills.map((s) => [Math.min(total - 1, Math.round(s.at * fps)), s.path]));
    for (let n = 0; n < total; n++) {
      const data = await page.evaluate((i) => { window.drawFrame(i); return document.getElementById("c").toDataURL("image/png"); }, n);
      const png = Buffer.from(data.slice(22), "base64");
      if (want.has(n)) writeFileSync(want.get(n), png);
      if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once("drain", r));
    }
    ff.stdin.end();
    await done;
    if (errors.length) throw new Error(`page error: ${errors[0]}`);
    return { out, frames: total, fps, seconds: +(total / fps).toFixed(2), sounds, wav };
  } finally {
    await browser.close();
    server.close();
  }
}

