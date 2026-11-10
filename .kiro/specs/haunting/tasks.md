# Implementation Plan: haunting

## Overview

Order: AI disambiguation (independent), UI seams, pure haunt logic, DOM effects and wiring, yes/no and XYZZY text, MIC layout, dist/isolation checks, final checkpoint. Tests run with `npx vitest --run`. Tasks marked `*` are optional (property tests); every other task is required and includes its own example tests.

Rules for every task:

- Do not modify `src/engine`, `src/data`, `original/`, `reference/`, `src/parse-api`, `functions/`, `migrations/`, `wrangler.toml`. No `wrangler` command, no deploy, no commit.
- Layering: `src/ui` imports nothing from `src/haunt`, `src/voice`, `src/parser`, `src/shared`, `src/parse-api`. `src/main.ts` reaches `src/haunt` only through dynamic `import()`. `src/haunt` imports only itself, `src/shared`, `src/engine`, `src/data`. Files directly in `src/ui/*.ts` (not `dom/`) use no browser globals or timers.
- 1976 mode behavior stays byte-identical: fidelity, walkthrough and existing UI tests must keep passing unchanged. If a task seems to require editing an existing test's assertion, only do so for the constants this spec changes (`DEFLECTION_LINE`) and say so.
- Narrator text: sentence case, plain ASCII, clean humor, no brands, no gore.

## Tasks

- [x] 1. AI object disambiguation (Requirement 6.4)
  - [x] 1.1 Move `damerauLevenshtein` to `src/shared/edit-distance.ts` and re-export it from `src/voice/edit-distance.ts` so existing voice code and tests are unchanged.
  - [x] 1.2 Create `src/shared/object-match.ts` with `pickClosestObject` as in the design (stop list, support check, prefix then distance then order, bound `<= 2` and `< token length`, re-validate with `validateCommand`).
  - [x] 1.3 In `src/parser/ai-parser.ts` `run`, apply it after a `translated` result using candidates built from `input.state` (room objects plus carried; carried only when dark). Leave `buildGameContext`, the request schema and the server untouched.
  - [x] 1.4 Example tests: "grab the lab" -> `TAKE LAMP` with lamp visible; unchanged when lamp absent; unchanged when the model's object is supported by the text ("take the keys"); tie-break order; result always passes `validateCommand`.

- [x] 2. UI seams (Requirements 1, 5.2, 6.1)
  - [x] 2.1 Add `TurnInfo` and the third argument to `NarratorLineProvider` and `EventObserver` in `src/ui/extension-hooks.ts`; build it in `GameController.deliver`/`present` (before state, after state, transformed line, origin; `before` undefined at game start). Add `count?: false` to the deflect `GateResult`, keep it through `validDeflect`, and make `applyDeflection` skip the counter bump when `count === false`.
  - [x] 2.2 Add the `spoken` `LineKind`: `types.ts`, `autosave.ts` (`LINE_KINDS`, `AUTOSAVE_LINE_KINDS`), `echo(line, origin)` in the controller, the `line--spoken` class path in `src/ui/dom/terminal-view.ts`, and CSS in `src/ui/crt.css` (mic marker via `::before`, keep the `input` look otherwise; also the `data-crt="off"` variant). Grep every use of the `'input'` kind and treat `spoken` the same where behavior (not just style) depends on it.
  - [x] 2.3 Example tests: `TurnInfo` reaches providers with correct before/after/origin; a non-counting deflection leaves `deflections` unchanged and does not call `step`; a spoken line is echoed as `spoken`, autosaved and restored with its kind; a typed line stays `input`; 1976 mode never calls providers/observers.

- [x] 3. Pure haunt logic (Requirements 1, 2, 3, 4, 5.1)
  - [x] 3.1 `src/haunt/moments.ts`: `detectMoments(turn, events)` per the design table. Verify field names (`dwarves`, `lmwarn`, `limit`, `objects[].place/prop`, `session.pending.k`) against `src/engine/types.ts` and constants against `src/data/constants.ts` before use.
  - [x] 3.2 `src/haunt/lines.ts` (pools: at least 3 per moment; death groups with escalation for deaths 2 and 3; reincarnation countdown plus quips; farewell; spoken-XYZZY reactions; maze) and `src/haunt/narrator.ts` (cooldown 3 turns, once per kind per life, bypass kinds, deterministic rotation from an injected seed, no engine RNG, never reads or writes `lcg_x`).
  - [x] 3.3 `src/haunt/dim.ts` (`dimLevel`, `DIM_START = 150`, `DIM_FLOOR = 0.6`) and `src/haunt/glitch.ts` (glitch on visit 1, then every 4th).
  - [x] 3.4 Example tests: detection of each moment on real engine states where practical (drive `step` with a seed and scripted lines) and on constructed diffs otherwise; cooldown, per-life limit, bypass kinds, determinism for equal seeds, pools have >= 3 lines, all lines are plain ASCII and at most 160 chars; dim bounds, monotone in `limit`, 1 when lamp off, recovers after batteries; glitch cadence; contrast of `--fg` and `--narrator` scaled by the floor is >= 4.5:1 (compute from `crt.css` tokens).
  - [ ]* 3.5 Property tests: narrator output never contains or alters original text and the picker never changes the engine RNG (state after `step` equal with and without the narrator); `dimLevel` stays within [0.6, 1] for any `limit`.

- [x] 4. Effects, assembly and wiring (Requirements 1-5)
  - [x] 4.1 `src/ui/dom/haunt-effects.ts`: `setDim`, `flashGlitch`, `reincarnate`, `reset`, honoring a `MotionPreference`; Web Audio sting created lazily with try/catch, low gain; key/pointer press cancels the flicker; timers only here; text only through `textContent`/text node data (no `innerHTML`). CSS in `crt.css`: `html[data-game-mode="haunted"] .crt` brightness rule and `haunt-flicker`, all disabled or stepped under `prefers-reduced-motion`.
  - [x] 4.2 `src/haunt/haunting.ts` `createHaunting({ hooks, effects, motion, seed })` registering the narrator provider, the dim/reincarnation observer, the glitch output listener, and `gameStart(state)` / `dispose()`. `hooks` and `effects` are structural types declared in `src/haunt`.
  - [x] 4.3 `src/haunting-loader.ts` (pattern of `src/ai-loader.ts`): loads both chunks on the first Haunted game start, calls `gameStart` with `controller.engineState` on every Haunted start, and on a 1976 start disposes and calls `effects.reset()`. Failures are logged and ignored. Add it to the `createGameStartFanOut` list in `src/main.ts` with dynamic imports only.
  - [x] 4.4 Example tests: with a fake effects object, a full scripted game through the real controller shows narrator lines after the original text, original text identical to a run without haunting, dim values follow `limit`, glitch fires on the "all alike" block and the transcript text is unchanged, reincarnation triggers one effect call and a narrator block, and a thrown error inside haunt code leaves the game playable. Loader tests: no chunk load in 1976, dispose on switch to 1976, load failure is non-fatal.

- [x] 5. Yes/no and XYZZY text (Requirements 5.1, 5.3, 6.1, 6.2)
  - [x] 5.1 `src/haunt/yes-no.ts`: alias transformer and nudge gate (non-counting deflect, at least 3 nudges with a YES/NO cue), registered in `createHaunting`. Add the spoken-XYZZY reaction pool use (Requirement 5.1; spoken lines are never deflected).
  - [x] 5.2 Rewrite `DEFLECTION_LINE` in `src/haunt/spoken-word-rule.ts` (funny, narrator voice, <= 160 chars, still says aloud + mic/Alt+M + type again). Update the tests that hardcode its old length/uppercase form; `DEFLECTION_LIMIT` and the autosave coupling are unchanged.
  - [x] 5.3 Example tests: "sure/ok/okay/please" become YES and "nope/nah/no thanks" NO before `step`; unrelated text at a yes/no prompt shows a nudge, does not reach the engine, does not bump `deflections` and does not consume the XYZZY deflection; in 1976 mode the engine's "Please answer the question." still appears; the reincarnation prompt accepts "sure"; a spoken XYZZY produces the reaction and still reaches the engine.

- [x] 6. Checkpoint: run `npx vitest --run` and `npm run typecheck`; fix failures before continuing.

- [x] 7. MIC visibility (Requirement 6.3)
  - [x] 7.1 Add `playwright-core` as an exactly pinned devDependency (no browser download) and write `scripts/check-layout.ts` per the design. Build first (`npm run build`), serve `dist/` locally with `vite preview` or a static server, and run it against the current CSS to record the baseline (expected: fails at one or more sizes). Report if no Chromium-based browser is installed instead of skipping silently.
  - [x] 7.2 Apply the CSS changes from the design (and `index.html` only if markup must move; keep `#mic-disclosure`, its text and `hidden` default intact). Re-run until 1280x720, 1366x768 and 1024x600 all pass, and spot-check 390x844 (mobile) does not regress.
  - [x] 7.3 Add a `package.json` script `check:layout` and a short note in the README. Add a CSS-text example test for the new rules where practical (no layout in happy-dom).

- [x] 8. Isolation and dist checks (Requirement 7)
  - [x] 8.1 Add a distinctive marker constant to the haunt chunk and extend `scripts/check-dist.ts` (and its fixture test) so the start script must not contain it and a lazy chunk must. This is the guard that 1976 and the main bundle do not grow with haunt code.
  - [x] 8.2 Example test: in 1976 mode the controller with the real haunting loader never loads haunt/effects modules, never calls hooks, and the transcript equals the upstream-style output.
  - [ ]* 8.3 Property test: for arbitrary command sequences, Haunted-with-haunting and 1976 produce identical engine state (haunting never feeds the engine other than via the existing transformer and gate).

- [x] 9. Final checkpoint: `npm run typecheck`, `npx vitest --run` (includes fidelity, walkthrough, layering, lint), `npm run build`, `npm run check:dist`, `npm run check:layout`. Report anything that could not be run. Do not commit or deploy.
