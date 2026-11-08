# Implementation Plan: game-engine

## Overview

This plan builds the Game_Engine as a pure TypeScript port of Open Adventure (reference commit `e6160529e70a8c7a06b9a5f190d69aa35c4c62f5`), in this order:

1. Project scaffolding.
2. The Data_Generator and generated Game_Data.
3. Engine foundations: types, RNG, state, IO, renderer and classic parser.
4. The Replay_Harness, Skip_List and Fidelity_Suite, built before the game logic so that every later porting step can be measured against the upstream logs.
5. Game logic: score, travel, dwarves, actions, save/resume, main loop, and the public API. After each sub-task the Fidelity_Suite is run and its pass count reported (it starts near 0 and grows).
6. Property tests, the CLI and static lint tests.
7. The seed-independence property and the win430 walkthrough, at the end.

Language: TypeScript (strict), as given by the design. Tests run with `vitest --run`. Every ported function carries a `// C: <function>` comment and every ported file carries the BSD-2 notice. Never modify `original/` or `reference/`.

Design clarifications C-1 to C-8 guide the tasks, with the requirements kept as written:

- Property tests for `randrange` use n in 1..2048 (C-2).
- The score lower bound is asserted only for sequences of up to 100 commands from a new game (C-3).
- Data-string comparison happens after the C escape pass (C-1).
- `#` lines are skipped inside `get_input` only (C-4).
- RNG order is verified transitively through the `.chk` files, plus pinned `set_seed` vectors (C-6).
- The harness uses one fixed default seed (C-8).

The Skip_List has exactly 4 entries: `savetamper`, `cheatresume`, `cheatresume2` and `resumefail2`. `resumefail` is not skipped.

Fidelity pass-count reporting (tasks 8.1 to 8.9): "run the fidelity suite" means `vitest --run tests/fidelity.test.ts`. Report the number of passing logs out of the non-skipped total. A low count before checkpoint 9 is expected and is not a failure; a count that drops after a sub-task is a regression to investigate.

Property test files are split one per property under `tests/properties/` (instead of a single `engine.properties.test.ts`) so tasks can run in parallel. The shared builders live in `tests/support/generators.ts`.

## Tasks

- [x] 1. Scaffold the project
  - [x] 1.1 Create project configuration and directory skeleton
    - Create `package.json` with exact-pinned versions (no `^`, `~` or ranges) for `typescript`, `vite`, `vitest`, `fast-check` and `yaml`. Look up current versions with `npm view` before pinning.
    - Add scripts: `gen:data` (runs `scripts/generate-data.ts`), `test` (`vitest --run`) and `typecheck` (`tsc --noEmit`).
    - Create `tsconfig.json` (strict) and a Vitest config. Add a runner for the TS scripts (for example `tsx`, also pinned).
    - Verify `.gitignore` excludes `node_modules/`, `dist/`, `.env*` and does not exclude `.kiro/`.
    - Create the empty directories `src/engine`, `src/data`, `scripts`, `tests`, `cli`.
    - _Requirements: 19.3, 19.4_

- [x] 2. Implement the Data_Generator and generate Game_Data
  - [x] 2.1 Implement `scripts/generate-data.ts`
    - Port `make_dungeon.py` function for function, including `buildtravel` and the legacy `cond*1000+dest` encoding.
    - Read `original/adventure.yaml` as bytes and fail on any byte above 0x7F.
    - Parse as YAML 1.1 (`!!omap` as ordered pairs, merge keys, anchors/aliases).
    - Check the 10 required top-level sections. On any problem, exit non-zero, name the file, and write nothing. Write to temp names and rename only after all files are complete.
    - Apply the C escape pass (C-1): decode `\n`, `\t`, `\\`, `\"`, `\'`, `\r`, `\a`, `\b`, `\f`, `\v`, `\ooo`, `\xhh`. Fail listing the string on any other escape.
    - Compute `IGNORE`, `BIRD_ENDSTATE` and the state-label constants. Keep `null` and `""` distinct.
    - Emit `src/data/constants.ts`, `src/data/dungeon.ts` and `src/data/travel.ts` with `JSON.stringify` literals. No timestamps, no absolute paths.
    - Each file starts with a header: generated/do-not-edit notice, the exact regeneration command, and the BSD-2 notice.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 19.6_

  - [x] 2.2 Run the generator and add the golden dungeon summary
    - Write `scripts/dump-reference-dungeon.py`. It copies `original/adventure.yaml` and `reference/open-adventure/{make_dungeon.py,templates}` to a temp directory (never writing into `reference/`), runs `make_dungeon.py`, and writes `tests/golden/dungeon-summary.json`.
    - The summary holds table counts and a SHA-256 of the canonical dump of `travel`, `tkey` and `conditions`.
    - Run `npm run gen:data` and commit the generated `src/data/*`. Check that a second run is byte-identical.
    - Fall back to documenting the counts by hand from the YAML if Python is unavailable.
    - _Requirements: 1.4, 1.7_

  - [ ]* 2.3 Write generator unit tests
    - Create `tests/generator.test.ts`.
    - Cover the header, determinism (two runs), `original/` and `reference/` untouched (bytes and size), failure on missing/invalid YAML or a missing section with previous output left intact, and counts/order/travel hash against `tests/golden/dungeon-summary.json`.
    - Compare every generated string with the YAML source after the C escape pass, and list the 5 strings that contain a literal `\n` or `\t` (C-1).
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

  - [ ]* 2.4 Write property test for the C escape round trip
    - **Property 35: C escape round trip**
    - File: `tests/properties/p35-c-escape.test.ts`.
    - **Validates: Requirements 1.5**

- [x] 3. Checkpoint - Generated data
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Build engine foundations
  - [x] 4.1 Define engine types and events
    - Create `src/engine/events.ts` and `src/engine/types.ts` with `Game`, `Session`, `CommandT`, `Word`, `Pending`, `GameState`, `OutputEvent`, `StepResult`, `Env`, `Storage` and `EngineBug`.
    - The types must match the Data Models section of the design and be JSON-safe.
    - Include the BSD-2 notice in the first comment block.
    - _Requirements: 3.5, 14.1, 14.2, 14.6, 19.1_

  - [x] 4.2 Implement `src/engine/rng.ts`
    - Port `set_seed`, `get_next_lcg_value` and `randrange`, plus a `pct` helper, with LCG_A=1093, LCG_C=221587, LCG_M=1048576.
    - Use `Math.imul` for `range * old_x`. Use JS truncating `%` and add LCG_M when negative.
    - `setSeed` draws 5 times for `zzword`, with index 1 forced to `'`.
    - Add the test-only `env.rngTrace` hook.
    - Use no `Math.random`, `Date` or other nondeterminism.
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 19.1, 19.2_

  - [x] 4.3 Write property test for the RNG formulas
    - **Property 1: RNG matches the C formulas**
    - File: `tests/properties/p01-rng-model.test.ts`.
    - Compare against an independent BigInt model, for n in 1..2048.
    - Add hand-computed `set_seed` vectors for 3 seeds (C-6).
    - **Validates: Requirements 2.1, 2.2, 2.5**

  - [x] 4.4 Write property test for RNG output ranges
    - **Property 2: RNG output ranges**
    - File: `tests/properties/p02-rng-ranges.test.ts`.
    - Use n in 1..2048 (C-2). Check the `zzword` shape and `lcg_x` in 0..1048575.
    - **Validates: Requirements 2.5, 2.6, 16.5**

  - [x] 4.5 Implement `src/engine/objects.ts` and `src/engine/init.ts`
    - Port `juggle`, `move`, `put`, `carry`, `drop`, `atdwrf`, `setbit`, `tstbit` and the `advent.h` macros.
    - Port `initialise` as `newGame(seed, options)`, in the same order, with the same RNG calls: static initializer, `set_seed`, dwarf locations, objects, `atloc`/`link` drop loops, props/tally, `conds`.
    - Compute the module-level `CONDITIONS_EFFECTIVE` (FORCED bit) once from `CONDITIONS` and the travel table.
    - Add `cloneState` and a dev-mode `deepFreeze` helper.
    - _Requirements: 3.1, 3.3, 3.5, 3.6, 19.1, 19.2_

  - [ ]* 4.6 Write unit tests for the initial state
    - Create `tests/init.test.ts`.
    - Check `newGame` equals itself for the same seed/options, key `initialise` values, and the RNG draw count at init.
    - _Requirements: 3.1, 3.6_

- [x] 5. Implement IO, rendering and the classic parser
  - [x] 5.1 Implement `src/engine/io.ts` and `src/engine/render.ts`
    - Port `vspeak`, `speak`, `sspeak`, `pspeak`, `rspeak`, `get_input`, `yes_or_no`, `silent_yes_or_no` and `myreadline`.
    - Handle `%d`, `%s`, `%S`, `%V`, the `floor` to `ground` pass, the 4096-byte truncation, and NULL/empty messages printing nothing.
    - Text events carry `template` and `text`. `get_input` emits the `\n`, the `prompt` event and the echo, and skips `#` lines only while a `get_input`-style pending is active (C-4).
    - File-name reads are raw (no echo, no `#` skipping).
    - Implement `render(events, { echo })` using the channel-to-bytes table. Skip unknown event types and return `""` for an empty list.
    - _Requirements: 4.6, 14.1, 14.3, 14.4, 14.5, 14.7, 14.8_

  - [x] 5.2 Implement `src/engine/classic-parser.ts`
    - Port `word_count`, `get_*_vocab_id`, `get_vocab_metadata`, `tokenize`, `get_command_input`, `clear_command` and `preprocess_command`.
    - Use `strncasecmp` over TOKLEN=5, ASCII-only folding, `sscanf("%s%s")` splitting on C `isspace`, and the 1023 code-unit input cap.
    - Lookup order: motion, object, action, `zzword`, integer.
    - Handle the `oldstyle` extras (uppercase, truncate to 10, `IGNORE`).
    - Add no fuzzy, phonetic, alias or edit-distance matching.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.7, 4.9_

  - [ ]* 5.3 Write property test for the renderer
    - **Property 34: Renderer ignores non-text and unknown events**
    - File: `tests/properties/p34-render.test.ts`.
    - **Validates: Requirements 14.5, 14.7, 14.8**

  - [ ]* 5.4 Write property test for vocabulary matching
    - **Property 7: Vocabulary matching**
    - File: `tests/properties/p07-vocabulary.test.ts`.
    - **Validates: Requirements 4.1, 4.7**

- [x] 6. Checkpoint - Foundations
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Build the Replay_Harness and Fidelity_Suite
  - [x] 7.1 Implement `tests/replay-harness.ts` and a stub public API
    - `parseOptions` collects text after the first `#options:` on every matching line, shell-splits it, and parses `getopt("dl:or:")`. `-o` sets `oldstyle`; `-l` and `-d` are accepted and ignored; `-r NAME` passes the fixture to `start`.
    - `splitLog` uses getline semantics (a trailing LF adds no extra line). Read logs and checks as `latin1`.
    - `MemoryStorage` returns false on write for empty names or names ending in `/`.
    - `FIXTURE_DEPENDENCIES` replays `saveresume.1` before `saveresume.2` and `saveresumeopt`, and `saveresume.3` before `saveresume.4`. A static garbage fixture serves `../main.o`.
    - The loop runs `start`, then `step` per line until `status==='over'`, then `endOfInput`.
    - `HARNESS_DEFAULT_SEED = 0`.
    - The diff reporter names the log plus the first differing line number and content.
    - Never write under `reference/`.
    - Create a temporary `src/engine/index.ts` that re-exports `newGame` and `render` and exports `start`, `step` and `endOfInput` as stubs that throw `EngineBug('not implemented')`. Task 8.8 replaces the stubs. The harness must catch a thrown error per log and report it as that log's failure, so the suite runs to completion with a pass count of about 0.
    - _Requirements: 4.6, 15.2, 15.3, 15.4, 15.5, 15.8, 15.9, 15.14_

  - [x] 7.2 Implement `tests/fidelity-skip-list.ts`
    - Export `SKIP_LIST` with exactly 4 entries: `savetamper`, `cheatresume`, `cheatresume2` and `resumefail2`, each with a one-line reason (the three cheat-tool fixtures, and the C binary save `resume_badversion.adv` with no generating rule).
    - Note in the comments that `resumefail` is not skipped (it loads no fixture and exercises only the failed-open path through the storage interface).
    - `badmagic`, `savefail` and `saveresume.1–4` stay active.
    - _Requirements: 15.6, 15.11_

  - [x] 7.3 Implement `tests/fidelity.test.ts`
    - Discover every `*.log` directly in `reference/open-adventure/tests/` (sorted) and create exactly one test per log, named by base filename.
    - Skipped logs (exactly the 4 in `SKIP_LIST`) are reported as named `it.skip` entries with their reason.
    - A missing `.chk` fails that case only. Compare byte for byte.
    - Add guard tests that fail if a Skip_List name matches no log, or if a skipped log uses no `cheat`/binary-save fixture.
    - Run with a single `vitest --run`.
    - Run the suite once against the stub API and report the baseline pass count (expected 0 or near 0).
    - _Requirements: 7.9, 12.7, 15.1, 15.4, 15.5, 15.6, 15.7, 15.10, 15.11, 15.12_

  - [ ]* 7.4 Write harness unit tests and a log-splitting property test
    - **Property 36: Log splitting**
    - Files: `tests/harness.test.ts`, `tests/properties/p36-log-splitting.test.ts`.
    - Cover `parseOptions` for `oldstyle.log`, `logopt.log` and `saveresumeopt.log`, plus fixture dependency order.
    - **Validates: Requirements 15.2, 15.3**

- [x] 8. Implement game logic and the public API
  - [x] 8.1 Implement `src/engine/score.ts`
    - Port `score` as a pure `computeScore(game, mode)` returning `{ score, max }`, plus the printing wrapper.
    - Port `terminate`: score output, `TOOK_LONG`/`WITHOUT_SUSPENDS`, class rank messages, `status='over'`, and the `game-over` event.
    - Keep C behavior with no clamping (C-3).
    - After completing this sub-task, run the fidelity suite and report the pass count.
    - _Requirements: 10.1, 10.2, 10.3, 10.6, 10.7, 11.7, 12.5_

  - [x] 8.2 Implement `src/engine/travel.ts`
    - Port `playermove` and `traveleq`.
    - Cover table-order evaluation, probability conditions with the RNG call order, forced moves, mazes, plover, dragon/troll, bridge, pit, bear, invalid-motion refusal text, and the magic-word sequence (`foobar`).
    - After completing this sub-task, run the fidelity suite and report the pass count.
    - _Requirements: 5.1, 5.2, 5.4, 5.5, 5.6, 5.7_

  - [x] 8.3 Implement `src/engine/dwarves.ts`
    - Port `dwarfmove` and `spotted_by_pirate`.
    - Cover dwarf activation, movement and tracking, knife throw and hit chance, `dkill` and `dtotal`, and pirate theft to the chest. Keep RNG count and order identical to C.
    - After completing this sub-task, run the fidelity suite and report the pass count.
    - _Requirements: 7.1, 7.2, 7.3, 7.6, 7.7, 7.8_

  - [x] 8.4 Implement `src/engine/actions-special.ts`
    - Port the handlers that block or end the game: `attack` (including the silent bare-hands dragon question), `quit`, `read` (oyster clue), `bigwords` (magic-word events), `blast`, and the `suspend`/`resume` entry points.
    - Each sets a `Pending` tag and returns a `Blocked` marker, with a matching resume function that continues at the exact C continuation.
    - Emit `magic-word-used` events.
    - After completing this sub-task, run the fidelity suite and report the pass count.
    - _Requirements: 4.8, 6.3, 6.7, 12.4_

  - [x] 8.5 Implement `src/engine/actions.ts`
    - Port the `action` dispatcher and the non-blocking handlers of `actions.c`: `vcarry`, `discard`, `lock`, `light`, `extinguish`, `eat`, `drink`, `feed`, `fill`, `find`, `inven`, `brief`, `listen`, `fly`, `vbreak`, `pour`, `rub`, `wave`, `wake`, `seed`, `waste`, `throwit`, `say`.
    - Preserve `INVLIMIT`, bird/cage/rod/vase rules and `state_change`. Return the `phase_codes_t` values.
    - Import the blocking and special handlers from `actions-special.ts` (task 8.4).
    - After completing this sub-task, run the fidelity suite and report the pass count.
    - _Requirements: 6.1, 6.2, 6.4, 6.5, 6.6, 6.7, 6.8, 7.4, 7.5_

  - [x] 8.6 Implement `src/engine/save-resume.ts`
    - Port `savefile`, `suspend`, `resume`, `restore` and `is_valid` against the JSON Save_Document with fixed key order (`magic`, `version` 32, `canary` 2317, `game`, `session`).
    - `serialize` is canonical. `deserialize` returns `{ ok, state } | { ok:false, reason }` and never throws.
    - Reject with `BAD_SAVE` for non-JSON, wrong type, over 1,000,000 characters or wrong magic/canary. Reject with `VERSION_SKEW` (printed as `v/10.v%10`) for a version mismatch. Reject with `SAVE_TAMPERING` (then game over) for range failures.
    - The `saved += 5` penalty applies before the file-name read. The file-name loop prints `Can't open file NAME, try again.` on `storage` failure. Success sets `status='over'` with no score output (C-7). `RESUME` replaces `game` only.
    - Perform no file system or browser storage access.
    - After completing this sub-task, run the fidelity suite and report the pass count.
    - _Requirements: 13.1, 13.2, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9_

  - [x] 8.7 Implement `src/engine/main-loop.ts`
    - Port `main`, `do_move`, `do_command` (stage machine S1 to S5 with `applyPhase`), `describe_location`, `listobjects`, `checkhints`, `croak`, `lampcheck` and `closecheck`.
    - Implement the resume function for every `Pending` tag, and the `croak` origin continuations (`dwarf`, `nowhere`, `pit`, `bridge`).
    - Cover novice, hints, reincarnation, death at closing, pit fall, dark rooms, the lamp, and closing countdowns and restrictions.
    - Emit `room-entered`, `death`, `reincarnation-offered` and `prompt` events at the points the design lists.
    - Handle post-game input (one `game-over` event, no RNG draw), EOF at each pending kind, and the `oldstyle` prompt.
    - After completing this sub-task, run the fidelity suite and report the pass count.
    - _Requirements: 3.2, 3.8, 4.4, 4.5, 5.3, 5.7, 8.1, 8.2, 8.3, 8.5, 8.6, 8.7, 8.8, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.8, 12.1, 12.2, 12.3, 12.6_

  - [x] 8.8 Implement the public API in `src/engine/index.ts`
    - Replace the stubs from task 7.1. Export `newGame`, `start(state, env, restoreText?)`, `step(state, line, env)`, `endOfInput`, `render`, `serialize`, `deserialize` and the types.
    - `step` clones the input state first, so the input is never mutated. Wrap results as `StepResult`.
    - Emit `lamp-level` (at most one per step, when `limit` differs from `session.reportedLimit`, carrying `GAMELIMIT`), `score` (when the score differs from `session.reportedScore`) and `game-over` events.
    - Re-export types so the engine imports nothing from `ui`, `haunt`, `parser` or `voice`.
    - After completing this sub-task, run the fidelity suite and report the pass count and the names of any failing logs.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 8.4, 10.4, 14.1, 14.2_

  - [ ]* 8.9 Write save/resume unit tests
    - Create `tests/save-resume.test.ts`.
    - Build JSON Save_Documents directly for tamper, version-skew, bad magic, wrong types, oversized text and storage read/write failure paths, plus `saved` penalties and the abandon check.
    - These replace the Skip_List logs' coverage.
    - After completing this sub-task, run the fidelity suite and report the pass count.
    - _Requirements: 6.7, 13.5, 13.6, 13.8, 13.9, 15.13_

- [x] 9. Checkpoint - Fidelity
  - Run the full Fidelity_Suite. Every non-skipped log must pass and exactly the 4 Skip_List logs must be reported as skipped. Any failure means the port is wrong, not the test, so fix the engine.
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Write engine property tests
  - [x] 10.1 Create shared fast-check builders `tests/support/generators.ts`
    - Vocabulary-command arbitraries from `MOTIONS`, `OBJECTS` and `ACTIONS` words, mixed with magic words and `yes`/`no` answers.
    - A reachable-state builder that replays a generated command list from `newGame(seed)`.
    - A synthetic `Game` builder that starts from `newGame` and sets fields within `is_valid` bounds.
    - A common `numRuns: 100` config that prints the seed and shrunk counterexample.
    - _Requirements: 16.7_

  - [x] 10.2 Write property test for determinism
    - **Property 3: Determinism**
    - File: `tests/properties/p03-determinism.test.ts`.
    - **Validates: Requirements 2.7, 3.1, 16.4**

  - [ ]* 10.3 Write property test for step immutability
    - **Property 4: Step does not mutate its input**
    - File: `tests/properties/p04-immutability.test.ts`.
    - **Validates: Requirements 3.3, 16.6**

  - [x] 10.4 Write property test for step totality
    - **Property 5: Step is total**
    - File: `tests/properties/p05-totality.test.ts`.
    - Use strings of 0 to 100,000 code units, plus random verb/object pairs.
    - **Validates: Requirements 3.7, 6.8, 16.1**

  - [ ]* 10.5 Write property test for unknown words
    - **Property 6: Unknown words**
    - File: `tests/properties/p06-unknown-words.test.ts`.
    - **Validates: Requirements 3.8, 4.3**

  - [ ]* 10.6 Write property test for more than two words
    - **Property 8: More than two words**
    - File: `tests/properties/p08-two-words.test.ts`.
    - **Validates: Requirements 4.2**

  - [ ]* 10.7 Write property test for empty, whitespace and comment input
    - **Property 9: Empty, whitespace and comment input**
    - File: `tests/properties/p09-empty-input.test.ts`.
    - Follow C-4 and C-5 (whitespace-only is a null move; `#` is skipped only in `get_input` pendings).
    - **Validates: Requirements 4.5, 4.6**

  - [ ]* 10.8 Write property test for magic-word events
    - **Property 10: Magic-word events**
    - File: `tests/properties/p10-magic-events.test.ts`.
    - **Validates: Requirements 4.8**

  - [ ]* 10.9 Write property test for compiled travel
    - **Property 11: Compiled travel equals the YAML rules**
    - File: `tests/properties/p11-travel-oracle.test.ts`.
    - Write an independent oracle that walks the YAML travel rule lists.
    - **Validates: Requirements 5.1**

  - [ ]* 10.10 Write property test for the magic-word sequence
    - **Property 12: Magic-word sequence state machine**
    - File: `tests/properties/p12-foobar.test.ts`.
    - **Validates: Requirements 5.6**

  - [ ]* 10.11 Write property test for invalid motions
    - **Property 13: Invalid motions are harmless**
    - File: `tests/properties/p13-invalid-motion.test.ts`.
    - **Validates: Requirements 5.5**

  - [ ]* 10.12 Write property test for room entry and darkness
    - **Property 14: Room entry and darkness**
    - File: `tests/properties/p14-room-entry.test.ts`.
    - **Validates: Requirements 5.3, 8.6**

  - [ ]* 10.13 Write property test for world invariants
    - **Property 15: World invariants during play**
    - File: `tests/properties/p15-world-invariants.test.ts`.
    - **Validates: Requirements 6.2, 6.6, 7.2**

  - [ ]* 10.14 Write property test for pirate theft
    - **Property 16: Pirate theft**
    - File: `tests/properties/p16-pirate.test.ts`.
    - **Validates: Requirements 7.6, 7.7**

  - [ ]* 10.15 Write property test for original text in events
    - **Property 17: Text events carry the original text**
    - File: `tests/properties/p17-original-text.test.ts`.
    - **Validates: Requirements 7.8, 14.3**

  - [ ]* 10.16 Write property test for lamp rules
    - **Property 18: Lamp rules**
    - File: `tests/properties/p18-lamp.test.ts`.
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.7, 8.8**

  - [ ]* 10.17 Write property test for lamp-level events
    - **Property 19: Lamp-level events**
    - File: `tests/properties/p19-lamp-events.test.ts`.
    - **Validates: Requirements 8.4**

  - [ ]* 10.18 Write property test for hint counters
    - **Property 20: Hint counters**
    - File: `tests/properties/p20-hint-counters.test.ts`.
    - **Validates: Requirements 9.1**

  - [ ]* 10.19 Write property test for hint accounting
    - **Property 21: Hint accounting**
    - File: `tests/properties/p21-hint-accounting.test.ts`.
    - **Validates: Requirements 9.5, 9.6, 9.7**

  - [x] 10.20 Write property test for score bounds and purity
    - **Property 22: Score bounds and purity**
    - File: `tests/properties/p22-score-bounds.test.ts`.
    - Assert the lower bound of 0 only for sequences of up to 100 commands from a new game (C-3). Assert the upper bound of 430 everywhere.
    - **Validates: Requirements 10.3, 10.6, 12.5, 16.2**

  - [ ]* 10.21 Write property test for score events
    - **Property 23: Score events**
    - File: `tests/properties/p23-score-events.test.ts`.
    - **Validates: Requirements 10.4**

  - [ ]* 10.22 Write property test for yes/no answers
    - **Property 24: Yes/no answers**
    - File: `tests/properties/p24-yes-no.test.ts`.
    - **Validates: Requirements 11.3**

  - [ ]* 10.23 Write property test for reincarnation
    - **Property 25: Reincarnation**
    - File: `tests/properties/p25-reincarnation.test.ts`.
    - **Validates: Requirements 11.4**

  - [ ]* 10.24 Write property test for game end
    - **Property 26: Game end**
    - File: `tests/properties/p26-game-end.test.ts`.
    - **Validates: Requirements 11.5, 11.7**

  - [ ]* 10.25 Write property test that game over is absorbing
    - **Property 27: Game over is absorbing**
    - File: `tests/properties/p27-game-over-absorbing.test.ts`.
    - **Validates: Requirements 11.8, 12.6**

  - [ ]* 10.26 Write property test for the closing transition
    - **Property 28: Closing transition**
    - File: `tests/properties/p28-closing.test.ts`.
    - **Validates: Requirements 12.3**

  - [x] 10.27 Write property test for the serialization round trip
    - **Property 29: Serialization round trip and continuation**
    - File: `tests/properties/p29-roundtrip.test.ts`.
    - **Validates: Requirements 3.5, 9.8, 13.1, 13.2, 13.3, 16.3**

  - [ ]* 10.28 Write property test for canonical serialization
    - **Property 30: Canonical serialization**
    - File: `tests/properties/p30-canonical.test.ts`.
    - **Validates: Requirements 13.4**

  - [ ]* 10.29 Write property test for total deserialization
    - **Property 31: Deserialization is total**
    - File: `tests/properties/p31-deserialize-total.test.ts`.
    - **Validates: Requirements 13.5, 13.9**

  - [ ]* 10.30 Write property test for failed storage
    - **Property 32: Failed storage**
    - File: `tests/properties/p32-failed-storage.test.ts`.
    - **Validates: Requirements 13.8**

  - [ ]* 10.31 Write property test for typed JSON-safe events
    - **Property 33: Events are typed and JSON-safe**
    - File: `tests/properties/p33-events-json.test.ts`.
    - **Validates: Requirements 14.1, 14.6**

- [x] 11. Build the CLI runner
  - [x] 11.1 Implement `cli/advent-cli.ts`
    - Export `parseSeedArg` (optional `-`, decimal digits, signed 32-bit range). An invalid seed prints to stderr and exits non-zero before any state is created.
    - Print the opening text from `start` before reading input. Submit each stdin line unchanged to `step` and print `render(events, { echo: false })`.
    - Exit 0 on game over or end of input.
    - `FileStorage` implements the injected `Storage` with `fs`. A failed file operation is reported through the storage interface and play continues.
    - An internal engine error prints to stderr and exits non-zero.
    - The runner lives outside `src/engine/`. Add an npm script to launch it.
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8, 18.9_

  - [ ]* 11.2 Write CLI tests and the seed-parsing property test
    - **Property 38: CLI seed parsing**
    - Files: `tests/cli.test.ts`, `tests/properties/p38-seed-parsing.test.ts`.
    - Spawn-based examples with a temp directory cover the same-seed reproducibility, the invalid-seed exit, EOF exit, and save/resume file failures.
    - **Validates: Requirements 18.3, 18.4**

- [x] 12. Add static provenance and layering checks
  - [x] 12.1 Write `tests/lint.test.ts`
    - Fail naming the offending file, function or dependency when:
      - a ported source file lacks the BSD-2 notice;
      - a ported function lacks a `// C: <name>` comment;
      - a `package.json` dependency version contains a range operator or `latest`;
      - `src/engine/` imports from `src/ui`, `src/haunt`, `src/parser` or `src/voice`;
      - `src/engine/` references `Math.random`, `Date`, `performance`, `crypto`, DOM, network, timer or `fs` APIs;
      - the engine source contains a string literal copied from the YAML content;
      - `.gitignore` lacks `node_modules/`, `dist/` or `.env*`, or excludes `.kiro/`;
      - a generated file lacks the regeneration header.
    - _Requirements: 1.8, 2.3, 3.4, 13.7, 19.1, 19.2, 19.3, 19.4, 19.5, 19.6_

- [x] 13. Seed independence and full walkthrough
  - [ ]* 13.1 Write property test for seedless logs
    - **Property 37: Seedless logs are seed-independent**
    - File: `tests/properties/p37-seedless-logs.test.ts`.
    - Replay each non-skipped log that contains no `seed` command under arbitrary int32 default seeds. Compare with `.chk`.
    - **Validates: Requirements 15.14**

  - [x] 13.2 Implement `tests/walkthrough.test.ts`
    - Replay `reference/open-adventure/tests/win430.log` (raw bytes) through the harness, using its own in-log `seed` command. Author no new command list.
    - Assert the rendered output equals `win430.chk`, the final score is exactly 430, a `game-over` event exists, and all log commands were processed.
    - On a mismatch, report the 1-based turn, the command, and the expected and actual output of the first differing turn only.
    - Assert identical output on 2 consecutive runs. Use no wall-clock, network or unseeded randomness.
    - _Requirements: 10.5, 17.1, 17.2, 17.3, 17.4, 17.5_

- [x] 14. Final checkpoint - All tests pass
  - Run `vitest --run`. Confirm the Fidelity_Suite passes for every non-skipped log, exactly the 4 Skip_List logs (`savetamper`, `cheatresume`, `cheatresume2`, `resumefail2`) are reported as skipped, and win430 reaches 430.
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. The harness, skip list, fidelity suite (7.1 to 7.3) and the walkthrough (13.2) are not optional, because they are the primary fidelity check.
- The following property tests are required (not optional): Properties 1, 2, 3, 5, 22 and 29, and the shared generators (10.1).
- The Fidelity_Suite is built before the game logic (group 7) so that each sub-task in group 8 can report a growing pass count. A low count before checkpoint 9 is expected.
- Each task references specific requirements for traceability.
- Checkpoints ensure incremental validation. Checkpoint 9 is where most porting bugs will surface.
- Property tests validate universal properties. Unit tests and the Fidelity_Suite cover specific scenarios (dwarf fights, closing, special travel, hint wording).
- Never edit anything under `original/` or `reference/`. Read the reference files as raw bytes with LF endings.
- Requirements 1.5, 2.6/16.5, 4.5/4.6 and 10.3/16.2 are kept as written. The tests follow design clarifications C-1 to C-8 where the C source differs.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2"] },
    { "id": 3, "tasks": ["2.3", "2.4", "4.1"] },
    { "id": 4, "tasks": ["4.2"] },
    { "id": 5, "tasks": ["4.3", "4.4", "4.5", "5.1"] },
    { "id": 6, "tasks": ["4.6", "5.2", "5.3"] },
    { "id": 7, "tasks": ["5.4", "7.1", "7.2"] },
    { "id": 8, "tasks": ["7.3", "7.4"] },
    { "id": 9, "tasks": ["8.1"] },
    { "id": 10, "tasks": ["8.2"] },
    { "id": 11, "tasks": ["8.3"] },
    { "id": 12, "tasks": ["8.4"] },
    { "id": 13, "tasks": ["8.5"] },
    { "id": 14, "tasks": ["8.6"] },
    { "id": 15, "tasks": ["8.7"] },
    { "id": 16, "tasks": ["8.8"] },
    { "id": 17, "tasks": ["8.9", "10.1", "11.1", "12.1"] },
    {
      "id": 18,
      "tasks": [
        "10.2", "10.3", "10.4", "10.5", "10.6", "10.7", "10.8", "10.9", "10.10", "10.11",
        "10.12", "10.13", "10.14", "10.15", "10.16", "10.17", "10.18", "10.19", "10.20",
        "10.21", "10.22", "10.23", "10.24", "10.25", "10.26", "10.27", "10.28", "10.29",
        "10.30", "10.31", "11.2", "13.1"
      ]
    },
    { "id": 19, "tasks": ["13.2"] }
  ]
}
```
