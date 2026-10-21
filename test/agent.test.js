import test from "node:test";
import assert from "node:assert/strict";
import { designLoop, designPrompt, prepareLevel, runAttempt, writeTune, CEILING } from "../src/agent.js";
import { ClaudeModel, extractJson, StubModel } from "../src/model.js";
import { fakeClaude, fixtureTune, shiftedLevel, tmp, winningLevel } from "./helpers.js";

const tuneReply = { title: "Fixture", notes: [{ pitch: "C5", t: 1.5 }, { pitch: "E5", t: 2 }, { pitch: "G5", t: 2.5 }, { pitch: "C6", t: 3.25 }] };

test("writeTune retries once with the validator's errors", async () => {
  const model = new StubModel([{ notes: [{ pitch: "C5", t: 1 }] }, "Here you go:\n```json\n" + JSON.stringify(tuneReply) + "\n```"]);
  const tune = await writeTune(model);
  assert.equal(tune.notes.length, 4);
  assert.equal(model.calls, 2);
  assert.match(model.requests[1].prompt, /rejected:\n- a tune has 4 to 8 notes, this one has 1/);
});

test("the loop feeds the engine's per-note errors back and stops as soon as a design passes", async () => {
  const tune = fixtureTune();
  const model = new StubModel([shiftedLevel(0.2, 0.1), winningLevel(), winningLevel()]);
  const r = await designLoop(model, tune, { maxAttempts: 5 });
  assert.equal(model.calls, 2);
  assert.equal(r.attempts.length, 2);
  assert.equal(r.passed, true);
  assert.equal(r.best, 1);
  const first = r.attempts[0].score;
  assert.equal(first.notes[0].err, 0.204167); // gate opened 0.2 s late, plus the one-step lag
  assert.equal(first.notes[2].err, -0.095833);
  const second = model.requests[1].prompt;
  assert.match(second, /design attempt 2/);
  assert.match(second, /note 1 C5 target 1\.500 s: hit at 1\.704 s by h1\.m0 on barC5, error \+204 ms/);
  assert.match(second, /note 3 G5 target 2\.500 s: hit at 2\.404 s .* error -96 ms/);
  assert.ok(second.includes(JSON.stringify(r.attempts[0].level)), "the previous level is shown in full");
  assert.ok(!model.requests[0].prompt.includes("previous attempt"));
});

test("when nothing passes the loop stops at maxAttempts and keeps the closest run", async () => {
  const tune = fixtureTune();
  const model = new StubModel([shiftedLevel(0.3, 0), shiftedLevel(0.05, 0), "no json here", shiftedLevel(0.2, 0)]);
  const r = await designLoop(model, tune, { maxAttempts: 4 });
  assert.equal(model.calls, 4);
  assert.equal(r.passed, false);
  assert.equal(r.best, 1);
  assert.equal(r.attempts[2].ok, false);
  assert.match(model.requests[3].prompt, /rejected before simulation:\n- the reply had no JSON level object/);
  assert.match(model.requests[3].prompt, /best attempt so far is attempt 2/);
});

test("a failed model call stops the loop instead of being scored", async () => {
  const model = new StubModel([new Error("claude call failed (exit 1): budget")]);
  await assert.rejects(designLoop(model, fixtureTune(), { maxAttempts: 3 }), /claude call failed/);
});

test("prepareLevel fixes the world, drops a goal and enforces the ceiling", () => {
  const tune = fixtureTune();
  const lvl = { ...winningLevel(), world: { width: 99, duration: 60 }, goal: { event: "bar-hit" } };
  const p = prepareLevel(lvl, tune);
  assert.equal(p.ok, true);
  assert.deepEqual(p.level.world, { width: 20, height: 12, duration: 5.75 });
  assert.equal(p.level.goal, undefined);
  const high = winningLevel();
  high.parts.find((x) => x.id === "h2").y = 9.5;
  const bad = prepareLevel(high, tune);
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], new RegExp(`h2 reaches y = 10.7, above the ${CEILING} ceiling`));
  assert.match(prepareLevel({ schema: "goldberg-level/1", parts: [{ id: "x", type: "wheel" }] }, tune).errors.join(), /wheel/);
});

test("runAttempt scores straight from the engine's bar-hit events", () => {
  const a = runAttempt(winningLevel(), fixtureTune());
  assert.equal(a.ok, true);
  assert.deepEqual(a.hits.map((h) => [h.t, h.pitch]), [[1.504167, "C5"], [2.004167, "E5"], [2.504167, "G5"], [3.254167, "C6"]]);
  assert.equal(a.score.pass, true);
  assert.equal(a.replay.schema, "goldberg-replay/1");
});

test("designPrompt names the pass rule and the simulation length", () => {
  const p = designPrompt(fixtureTune());
  assert.match(p, /1\. C5 at t = 1\.500 s/);
  assert.match(p, /runs for 5\.75 s/);
  assert.match(p, /under 40 ms/);
});

test("ClaudeModel runs claude -p with no tools, no MCP and no session, prompt on stdin, in a temp folder", async () => {
  const dir = tmp();
  const fake = fakeClaude(dir, "ok {\"a\": 1}");
  const m = new ClaudeModel({ bin: fake.bin, pauseMs: 0 });
  const r = await m.ask({ system: "SYS", prompt: "PROMPT" });
  assert.equal(r.text, 'ok {"a": 1}');
  const seen = fake.seen();
  assert.equal(seen.input, "PROMPT");
  for (const flag of ["-p", "--no-session-persistence", "--strict-mcp-config", "--max-budget-usd"]) assert.ok(seen.argv.includes(flag), flag);
  assert.equal(seen.argv[seen.argv.indexOf("--tools") + 1], "");
  assert.equal(seen.argv[seen.argv.indexOf("--mcp-config") + 1], '{"mcpServers":{}}');
  assert.equal(seen.argv[seen.argv.indexOf("--system-prompt") + 1], "SYS");
  assert.match(seen.cwd, /tune-machine-/);
  assert.equal(m.calls, 1);
});

test("ClaudeModel surfaces an error result", async () => {
  const fake = fakeClaude(tmp(), "budget exceeded", { isError: true });
  await assert.rejects(new ClaudeModel({ bin: fake.bin, pauseMs: 0 }).ask({ system: "s", prompt: "p" }), /claude call failed .*budget exceeded/);
});

test("extractJson finds fenced and bare objects, with braces inside strings", () => {
  assert.deepEqual(extractJson('sure ```json\n{"a": "}"}\n```'), { a: "}" });
  assert.deepEqual(extractJson('x {"b": {"c": 2}} y'), { b: { c: 2 } });
  assert.equal(extractJson("nothing"), null);
});
