import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateTune } from "../src/tune.js";

export const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
export const fixtureTune = () => validateTune(JSON.parse(readFileSync(join(FIX, "tune.json"), "utf8"))).tune;
/** A level written by a script for the tests (one hopper per note), not by the agent. */
export const winningLevel = () => JSON.parse(readFileSync(join(FIX, "winning-level.json"), "utf8"));

/** The winning level with some gates moved: note 1 late by `late`, note 3 early by `early`. */
export function shiftedLevel(late = 0.2, early = 0.1) {
  const lvl = winningLevel();
  lvl.parts.find((p) => p.id === "h1").gate[0].open += late;
  lvl.parts.find((p) => p.id === "h3").gate[0].open -= early;
  return lvl;
}

export const tmp = () => mkdtempSync(join(tmpdir(), "tune-machine-test-"));

/** A stand-in `claude` binary: records its argv, cwd and stdin, and prints a canned print-mode result. */
export function fakeClaude(dir, replyText, { isError = false } = {}) {
  const bin = join(dir, "claude");
  writeFileSync(bin, `#!/usr/bin/env node
const fs = require("fs");
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  fs.writeFileSync(${JSON.stringify(join(dir, "seen.json"))}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), input }));
  process.stdout.write(JSON.stringify({ type: "result", is_error: ${isError}, result: ${JSON.stringify(replyText)}, num_turns: 1 }));
});
`);
  chmodSync(bin, 0o755);
  return { bin, seen: () => JSON.parse(readFileSync(join(dir, "seen.json"), "utf8")) };
}
