// The physics engine is the sibling repo goldberg-engine, used read-only: nothing here edits it.
// Its location comes from TUNE_ENGINE, else ../goldberg-engine next to this repo.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const ENGINE_ROOT = resolve(process.env.TUNE_ENGINE ?? join(ROOT, "..", "goldberg-engine"));
if (!existsSync(join(ENGINE_ROOT, "src", "index.js"))) {
  throw new Error(`goldberg-engine not found at ${ENGINE_ROOT}; set TUNE_ENGINE to its folder`);
}

const load = (rel) => import(pathToFileURL(join(ENGINE_ROOT, rel)).href);
const engine = await load("src/index.js");
const player = await load("renderer/player.js");
const synth = await load("scripts/synth.js");

export const { simulate, validateLevel, onsets, parsePitch, LevelError } = engine;
/** The renderer's own timeline: where each attempt sits in the clip, in output frames. */
export const { buildTimeline } = player;
/** The engine's offline synth: one struck-bar sound per event, mono 16-bit WAV. */
export const { synthWav } = synth;
export const RENDERER_DIR = join(ENGINE_ROOT, "renderer");
export const FPS = 60;

/** playwright-core, borrowed from the engine's own install so this repo has no npm dependencies. */
export function playwright() {
  return createRequire(join(ENGINE_ROOT, "package.json"))("playwright-core");
}
