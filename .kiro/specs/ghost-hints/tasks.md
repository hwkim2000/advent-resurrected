# Implementation Plan: ghost-hints

## Overview

Order: shared ask detection plus parser and Worker changes, hint table and view, gate wiring plus voice pools plus 4 MB, evaluation script, final checkpoint. Tests run with `npx vitest --run`. No optional tasks. Rules for every task:

- No commit, no deploy, no `wrangler` command, no network call to Workers AI or any endpoint. Do not modify `src/engine`, `src/data`, `original/`, `reference/`, `migrations/`, `wrangler.toml`. `src/parse-api` and `functions/` may change only as Task 1 states.
- Layering (enforced by `tests/ui-layering.test.ts`, `tests/voice/layering.test.ts`, `tests/lint.test.ts`): `src/ui` and `src/main.ts` change nothing in this spec. `src/haunt` imports nothing from `src/ui`, `src/voice`, `src/parser`; `src/shared` and `src/engine` are allowed. Narrator text rules from spec 5: plain ASCII, at most 160 characters, clean humor, no brands, no gore.
- 1976 mode stays untouched; the main start script must not change size (task 5 measures it).
- `public/voice/` is not modified (the owner regenerates audio). A failing manifest sync test for the new hint lines is expected after Task 3 and is reported, not worked around.

## Tasks

- [x] 1. Asking: shared detection, parser and Worker
  - [x] 1.1 Record the main start-script size (`npm run build`, `dist/assets/main-*.js` raw and gzip) before changes, for task 5.
  - [x] 1.2 Create `src/shared/ghost-ask.ts` per the design and verify against `src/shared/vocabulary.ts` that `ghost` is not a vocabulary word and against `src/shared/*` (`isClassicCommandText`) that no phrase is a classic command.
  - [x] 1.3 Parser: `classifyInput` passes ghost-prefix and exact-phrase lines without an AI call; `AiParser.interpretResponse` maps a decoded `GHOST` to `translated` `GHOST` before `validateCommand`; confirm the controller/`CommandMemory` need no change (read `src/parser/command-memory` and the controller `onResolved` path).
  - [x] 1.4 Worker: add the prompt rule and two examples in `src/parse-api/prompt.ts` and the sentinel branch in `src/parse-api/handler.ts`; keep request/response schemas. Run the prompt cost test and report whether it still passes unchanged.
  - [x] 1.5 Example tests: `ghost-ask` (prefix, phrases, near misses such as "ghostly", "HELP", "INFO", "take lamp"); eligibility passes ghost lines with no request; client maps a `GHOST` response (and still rejects other invalid outputs); handler returns 200 `{command:'GHOST'}` for a provider answer `GHOST` (case/whitespace tolerant) and still 422 for `NOCOMMAND` and garbage; prompt contains the new rule and examples and the original 8 examples unchanged.

- [x] 2. Hint table
  - [x] 2.1 Create `src/haunt/hint-view.ts` and `src/haunt/hints.ts` per the design. Verify every engine identifier first (`src/engine/types.ts`, `src/data/constants.ts`, `src/engine/objects.ts`, `src/data/dungeon.ts` object and location ids). 16 to 20 rules plus fallback, 2 to 3 sarcastic lines each, 40 to 60 lines in total, nudges not solutions, narrator voice and spec 5 style rules. Export `HINT_RULES`, `HINT_POOLS`, `HINT_TABLE_MARKER`.
  - [x] 2.2 Example tests: line count 40 to 60, 2 to 3 lines per rule (fallback may have 3), ASCII, at most 160 characters, global uniqueness (also against `ALL_POOLS`, `NUDGE_LINES`, `DEFLECTION_LINE`), no banned words used by the narrator tests; each rule fires on a constructed state and loses to earlier rules in ordered conflicts; fallback always last and always matches; the view is a pure function (does not mutate the state).

- [x] 3. Gate, wiring, voice pools
  - [x] 3.1 Create `src/haunt/ghost-gate.ts` per the design and register it in `src/haunt/haunting.ts` (new `getState` dep, gate before the yes/no gate, per-game variant counters reset in `gameStart`, disposer on `dispose`). Supply `getState` in `src/haunting-loader.ts`.
  - [x] 3.2 Add `HINT_POOLS` to `voiceLines()`; raise the total audio limit to 4 MB in `scripts/gen-voice.ts`, its test, `tests/voice-manifest-sync.test.ts` and the README; extend the voice-lines test to cover the hint lines and key uniqueness.
  - [x] 3.3 Example tests through the real controller (`tests/ui/support/fakes.ts` `makeController` plus the loader/haunting wiring used by existing haunting tests): "ghost help", "ghost, where do I go?" and "I'm stuck" in Haunted mode produce one narrator block after the echo, `step` is not called (engine state object identical, score and turns unchanged, `lcg_x` unchanged, `deflections` unchanged and autosave `ui` unchanged), repeated asks rotate variants, a changed situation changes the rule; with a resolver returning `translated GHOST` the dimmed translation shows and the same hint appears; "HELP" and "INFO" still reach the engine and print the original text; 1976 mode never answers; yes/no prompt gets the nudge not a hint; a throwing hint code path falls through to the engine; narrator speak is called with the hint line key.
  - [x] 3.4 Add `HINT_TABLE_MARKER` check to `scripts/check-dist.ts` (absent from the start script, present in a lazy chunk) with fixture tests, as done for the other markers.

- [x] 4. Evaluation script
  - [x] 4.1 Create `scripts/eval-parser.ts`, `scripts/eval-parser-cases.ts` and the `eval:parser` npm script per the design (about 20 command sentences with expected canonical commands, about 8 ask-ghost sentences, about 6 negatives expected `no_command`; 2.5 s pacing; no credentials; base URL argument required). Unit test the pure parts (case list shape, every expected command passes `validateCommand` or is `GHOST`/`NOCOMMAND`, scoring). Add a short README note on running it against a deployed or `dev:pages` server, and that the owner should re-run it after deploying the prompt change.

- [x] 5. Final checkpoint: `npm run typecheck`, `npx vitest --run`, `npm run build`, `npm run check:dist`, `npm run check:layout`. Expected: the only failure is the manifest sync test for the new hint lines (stale audio until the owner runs `npm run gen:voice`); confirm that and report any other failure. Compare the main start-script size with task 1.1 and report the delta (expected 0). Report the line count, rule count and prompt-cost test outcome. List `git status --short` and confirm nothing in the protected directories changed. Do not commit or deploy.
