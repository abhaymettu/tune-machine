# The Tune Machine

An agent writes a short tune. Then it builds a marble machine in a physics engine that plays the tune. Every note you hear is a real marble hitting a real bar in the simulation, at the time the engine logged.

It is built on [goldberg-engine](../goldberg-engine), the sibling repo with the deterministic 2D physics, the renderer and the audio synth. This repo only reads that engine; it never edits it.

## What happened on the first real run (Oct 21, 2026, about 3am)

Command: `node bin/run.js --attempts 5`. It made 4 model calls (Sonnet through the local `claude` CLI) and took 100 seconds, clip included.

1. **The tune.** The model wrote "Marble Lullaby", 8 notes: C5 at 1 s, E5 2, G5 3, E5 4, A5 5, G5 6, E5 6.5 and C5 7.5.
2. **Design 1.** Eight one-marble hoppers, each over its own tilted bar. All 8 notes landed within 4 ms, but each marble bounced on and struck the next bar: **7 extra notes**. It did not pass.
3. **Design 2.** The model tilted the bars the other way, so the marbles rolled left instead of right. Same problem in the other direction: **still 7 extra notes**.
4. **Design 3.** The model made the bars dead (restitution 0) and put a steep catch ramp under each one, to carry the marble to the floor. It also measured the fall at 0.895 s from design 2's errors and moved every gate 12 ms earlier. The result was **8 of 8 notes, 0 extra, every onset exactly on the score**, so the loop stopped.

The tune's onsets all sit on the engine's 1/240 s step grid, which is why the error is exactly 0 ms rather than a few. The engine reports a contact at the start of the step it happens in, so the true touch can lead the logged time by up to 4.2 ms.

The clip is `out/clip.mp4`: 16.4 s, 1280x720 at 60 fps, H.264 plus AAC. The full run folder is `out/run-20261021-080226/` and holds:
- the tune;
- every design the model sent;
- every prompt and reply, in `calls.jsonl`;
- the reel and per-note scores.

`out/` is not committed.

## How the clip is made

```
model writes tune -> model writes level -> engine simulates -> score onsets -> feedback -> ... -> reel -> recorder
```

- **Ghosts, then the winner.** The reel holds every valid design up to the winning one. The engine's own player (`goldberg-engine/renderer/player.js`) plays the earlier designs fast as faint ghosts, then the winner at real speed. It draws only recorded frames and never re-simulates, so you see the exact runs that were scored.
- **Overlay** (`recorder/overlay.js`), drawn on top of each frame:
  - a piano roll of the tune in the band above the machine, kept clear by a house rule: nothing may be built above y = 10.5;
  - each note turns green at the moment its logged bar hit happens if it is within 25 ms of the score, red otherwise;
  - extra hits show as red ticks;
  - the attempt counter, and a closing caption with the real counts from the run.
- **Audio** is the engine's synth (`goldberg-engine/scripts/synth.js`) fed one sound per `bar-hit` event of the winning run. Each sound sits at the winner's start in the clip plus the event's logged time. Nothing is placed by hand. Before writing audio, the recorder checks that its own list matches the engine player's `audioEvents()` event for event, and stops if they differ.
  - On the first run, the 8 sounds sit at 5.6, 6.6, 7.6, 8.6, 9.6, 10.6, 11.1 and 12.1 s of the clip. That is the 4.6 s winner start plus hits at 1, 2, 3, 4, 5, 6, 6.5 and 7.5 s.
- **Rendering.** Headless Chromium steps the page frame by frame, with no wall clock, and ffmpeg encodes the PNGs with the WAV.

## The agent loop

`src/agent.js`. Each call is a fresh `claude -p`:
- Sonnet;
- no tools (`--tools ""`);
- no MCP servers (`--strict-mcp-config` with an empty config);
- no saved session;
- `--max-budget-usd 0.5`;
- an empty temporary folder as the working directory;
- at least 4 seconds after the previous call.

It runs on your own `claude` login and uses no API key.

1. **Tune.** The model writes 4 to 8 notes:
   - pitches C4 to C7;
   - onsets 1 to 9 s;
   - at least 0.25 s between onsets.

   An invalid tune gets one retry, with the validator's errors.
2. **Design.** The model writes a whole `goldberg-level/1` level. Its system prompt holds:
   - the engine's generated schema doc;
   - the house rules: the world is fixed, a ceiling at y = 10.5, at most 40 parts and 16 marbles;
   - one measured fact about the engine, that a marble from a hopper with its gate at y = 9 hits a bar at y = 5 0.883 s after the gate opens.
3. **Simulate and score.** The engine runs the level, and `onsets()` lists the bar hits.
   - **Matching.** `scoreRun` matches hits to notes of the same pitch, in time order. A small dynamic program can leave a note unmatched (1 s penalty) or a hit unmatched (0.5 s penalty).
   - **Total error.** The sum of |hit time - note time| plus those penalties.
   - **Pass.** No missing notes, no extra hits, and a total under 10 ms per note.
4. **Feedback.** The next prompt carries the previous level in full, one line per note with its signed error in ms and which marble hit which bar, every extra hit, marbles that left the board, and the best design so far.
5. **Stopping.** The loop stops at the first pass, or after `--attempts` designs (default 5). If none passes, the clip shows the closest design and its caption says "closest of N designs; did not pass".

## Run it

Node 20 or newer, ffmpeg, and goldberg-engine checked out next to this repo. Point `TUNE_ENGINE` at it if it lives elsewhere. Recording also needs Playwright's headless Chromium (or set `CHROME_PATH`). It borrows `playwright-core` from the engine's install, so this repo has no npm dependencies.

```sh
node bin/run.js                          # model writes a tune, up to 5 designs, clip to out/clip.mp4
node bin/run.js --tune my-tune.json      # skip the tune call
node bin/run.js --attempts 3 --no-clip
node bin/record.js out/run-<stamp>/reel.json --out out/again.mp4   # re-record a saved run, no model
npm test
```

A run stops before starting if `/` has less than 30 GiB free.

## Tests

`npm test`: 24 tests, about 4 seconds. **The model is never called.** `StubModel` replays canned replies, and a fake `claude` script checks the exact flags the real call uses.

- **Scoring:** fixture hits give exact per-note and total errors. Also covered: the pass threshold, miss and extra penalties, wrong pitches, repeated pitches aligned in order, and the feedback text.
- **Tune validation.**
- **Loop with the model stubbed:**
  - the engine's measured errors reach the next prompt (for example "error +204 ms");
  - the loop stops on the first pass;
  - with no pass, it stops at the limit and keeps the closest design;
  - an unparseable reply is fed back as rejected;
  - a failed model call stops the run;
  - the house rules are enforced.
- **Audio wiring:**
  - every sound is a logged bar hit of the winning run at winner start plus its event time;
  - ghost designs are silent;
  - the synth WAV starts each note on the right sample.
- **Clip:** a real mp4 is recorded from the fixture winning level (headless Chromium and ffmpeg). The test checks its size and that it has an audio track. It also checks that the muxed WAV is exactly the synth of the logged hits. Removing any one note changes the WAV first at that note's logged sample (within 2 samples).

The fixture level in `test/fixtures/winning-level.json` was written by a script for the tests, one hopper per note. It is not agent-made, and its `notes` field says so.

## Not built (v0)

- **The snap-in assembly shot** from the proposal (the machine appearing part by part). The clip starts on the finished first design.
- **Short clip.** It runs 16.4 s, not 20 s, because only 3 designs were needed.
- **A staff.** The tune is shown as a piano roll band and a typed note list.
- **One real run so far.** The loop converged in 3 designs this time; another tune may take more or not converge in 5.
- **The agent's design range is narrow.** It has hoppers, bars, ramps and floor, and it built one column per note. Fitting fall times to onsets is a problem a plain optimizer could also solve; the model's real contributions here were the tune and fixing the bounce-on problem.
- **Fixed physics and frame.** Timing is measured in a deterministic simulation at 1/240 s steps, not in real-world physics. The world is fixed at 20 by 12 m.
- **Nothing public.** The repo is private, with no remote.
