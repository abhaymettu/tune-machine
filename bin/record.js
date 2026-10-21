#!/usr/bin/env node
// record <reel.json> --out <clip.mp4>: re-record a saved reel (no model, no re-simulation).
import { readFileSync } from "node:fs";
import { recordClip } from "../src/record.js";

const args = process.argv.slice(2);
if (!args[0] || !args.includes("--out")) { console.error("usage: record <reel.json> --out <clip.mp4>"); process.exit(2); }
const r = await recordClip(JSON.parse(readFileSync(args[0], "utf8")), args[args.indexOf("--out") + 1]);
console.log(JSON.stringify({ out: r.out, seconds: r.seconds, frames: r.frames, sounds: r.sounds.length }));
