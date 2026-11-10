# Implementation Plan: voice-input

## Overview

This plan adds voice input to Haunted mode: a provider-agnostic `SpeechProvider` with a Web Speech adapter, a pure session state machine with a thin shell, transcript cleaning, a deterministic magic-word matcher (alias table, bounded Damerau-Levenshtein, Stop_List), a Mic_Button with Voice_Status, Voice_Disclosure and Voice_Live_Region, seams in `src/ui` (Input_Origin, `addInputGate`, getters, autosave `ui` field, Deflection_Count), the Spoken_Word_Rule in `src/haunt`, lazy loading from `src/main.ts`, the `Permissions-Policy: microphone=(self)` header, `check:dist` extensions, and the README and credits text. Typing keeps working in every failure case, and 1976 mode never loads voice code or touches the microphone.

Order of work:

1. A verification spike for design items that can be checked offline (happy-dom pointer and click events, the fake `SpeechRecognition` shape, test-setup stubs, fast-check usage, the Damerau-Levenshtein approach, repo facts), with recorded fallbacks.
2. Prerequisites for the code issues found by the design: the disclosure constant, the layering test change, the no-capture test setup, the `check-dist` fixture helper extension, and shared test support.
3. The pure voice modules (`config`, `messages`, `speech-provider`, `clean`, `edit-distance`, alias table, matcher, yes/no, `decideFinal`) with their properties and example tests.
4. The `src/ui` seams (Input_Origin, gates, autosave `ui` field, controller changes, history cursor restore, deflection state) and the Spoken_Word_Rule in `src/haunt`.
5. The voice shell (adapter, session machine, session controller, detection, browser entry) and its tests.
6. The DOM module, markup and CSS, and the composition in `src/main.ts` (voice loader, fan-out).
7. Headers, `check:dist`, README and credits, with their tests.
8. Integration tests: 1976 isolation, the three-run win430 replay, typed-versus-spoken equivalence, and the layering scan.
9. A final checkpoint and an owner-only manual task for deployment, the real-device checklist and the header check.

Language: TypeScript (strict). Tests run with `npx vitest --run` (single run, never watch mode). The engine, data, parser, `original/` and `reference/` are not changed by any task.

Rules that apply to every task:

- No task runs `wrangler login`, `wrangler pages deploy`, `wrangler deploy`, `wrangler secret ...`, or any `wrangler` command at all. This spec needs none. No task touches the network, publishes the site, sets a secret or changes Cloudflare project settings. If a command asks for a login or tries to reach the network, STOP and use the recorded fallback. Deployment is the owner step in task 15.
- Do not modify anything under `src/engine`, `src/data`, `src/parser`, `original/` or `reference/`. Also leave `src/parse-api`, `functions/`, `migrations/` and `wrangler.toml` alone (no Worker, endpoint or secret change in this spec). If a task seems to need a change there, STOP and ask with `user_input`.
- No real microphone and no real network in tests. The setup guards (`tests/setup/no-network.ts` and the new `tests/setup/no-capture.ts` from task 2.3) make a test fail if it reaches `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`, `getUserMedia`, `MediaRecorder` or `createMediaStreamSource`. Tests use the fake provider, the fake `SpeechRecognition` class, the `FakeScheduler` clock and counting fakes. No test waits on real time.
- Layering: `src/ui` imports nothing from `src/voice`, `src/haunt`, `src/parser`, `src/shared` or `src/parse-api` (static, `import type` or dynamic). `src/main.ts` reaches `src/voice` and `src/haunt` only through dynamic `import()`. `src/voice` and `src/haunt` import nothing from `src/ui`, `src/parser` or each other (they may use `src/shared` and `src/engine`). The module that exports `matchMagicWords` is never imported by the typed path.
- Only `src/voice/web-speech-adapter.ts` may contain identifiers that begin with `SpeechRecognition` or equal `webkitSpeechRecognition` (comments and tests excluded). No file added or changed uses `speechSynthesis`, `SpeechSynthesisUtterance`, `getUserMedia`, `MediaRecorder` or `createMediaStreamSource`. No voice code writes to `localStorage`, `sessionStorage`, `IndexedDB`, cookies or a `KeyValueStore`. No `alert`, `confirm`, `prompt` or `<dialog` in voice or DOM code. Text reaches the DOM only through `textContent` and attributes.
- Existing tests are not edited except: `tests/ui-layering.test.ts` (task 2.2, the voice rule), the `makeDist` fixture helper in `tests/scripts/check-dist.test.ts` (task 2.4, fixture only, no assertion edited), and additive changes to `tests/ui/support/*` (task 5.5). The existing suite (fidelity against all upstream `.log` and `.chk`, walkthrough, UI, ai-parser) must keep passing.
- No new dependency. `fast-check` 4.10.2 and `happy-dom` 21.0.4 are already pinned exactly.
- Property-based tests use fast-check with `numRuns` of at least 100 and the fixed seed `VOICE_SEED` through `voiceAssert` from `tests/voice/support/pbt.ts`. One property per file under `tests/voice/properties/`, `tests/haunt/properties/` or `tests/ui/properties/`, named `pNN-<slug>.test.ts`, each tagged with the comment `// Feature: voice-input, Property N: <title>`, so files can run in parallel.
- Spoken text is never logged and never stored except as the normal input echo of a submitted line. Console entries from the voice layer contain only a Voice_Error_Code.
- If a spike shows that a design assumption is false, apply the recorded fallback. If a fallback would change requirement wording, STOP and ask the user with `user_input`; do not edit `requirements.md` on your own.

Required versus optional: all implementation tasks are required, so the required set alone delivers a complete, safe, working feature. These tests are also required:

- matcher: alias (P3), ordinary vocabulary (P7), sequence (P4), totality and determinism (P2), and the alias-table, Stop_List and corpus example tests (3.9);
- cleaning totality, bounds and idempotence (P1, 3.8), and the final-result decision order (P9, 3.14, 3.15);
- the session event-sequence property (P10, 8.11), the session lifecycle and error/start-failure example tests (8.9, 8.10), the adapter example tests (8.7) and the detection tests (8.8);
- the Input_Gate iff property (P18, 6.3), the Spoken_Word_Rule example tests (6.2, 6.4: once-per-game Deflection, autosave `ui` persistence, restore, resets), the gate registry, origin and autosave example tests (5.6, 5.7, 5.9) and the autosave round trip (P20, 5.8);
- the three-run win430 replay (13.2), typed-versus-spoken equivalence (P22, 13.3), the 1976 isolation tests (13.1) and the loader and fan-out tests (10.3);
- the layering and static tests with the new rules (2.2, 13.4), the headers parse test (12.6), the `check-dist` tests (12.7), the README test (12.8), the disclosure/`index.html` test (9.2), and the no-network and no-microphone guard (2.3);
- the core DOM tests for touch click, mouse and pen hold, hidden state and start-failure hiding (9.4).

The other tests are optional (marked `*`): secondary properties (P5, P6, P8, P11, P12, P13, P14, P15, P16, P17, P19, P21, P23, P24, P25), extra example tests that duplicate coverage, additional DOM edge-case tests, the contrast helper and CSS tests, the credits test and the frozen-paths test. The checkpoints run a git diff on the frozen paths instead.

## Tasks

- [x] 1. Verification spike (do this before any feature code)
  - [x] 1.1 Verify happy-dom pointer, click, focus and `hidden` support
    - In scratch tests named `tests/voice/spike-dom-*.test.ts` (happy-dom docblock, deleted afterwards), check on happy-dom 21.0.4: `new PointerEvent('pointerdown', { pointerType: 'touch', pointerId, isPrimary, button })` keeps `pointerType`, `isPrimary` and `button`; `MouseEvent('click', { detail })` keeps `detail` (0 for keyboard, 1 for pointer); `contextmenu` and `mousedown` honor `preventDefault` and report `defaultPrevented`; `setPointerCapture` exists; `KeyboardEvent` keeps `code`, `altKey`, `ctrlKey`, `metaKey`, `shiftKey`, `repeat`; `visibilitychange`, `pagehide` and `blur` can be dispatched; `button.focus()` and `input.focus({ preventScroll: true })` update `document.activeElement` and leave an input's `value`, `selectionStart` and `selectionEnd` unchanged; `hidden` removes an element from layout (`getComputedStyle(el).display` is `none` with and without the stylesheet).
    - Also check that a happy-dom `DOMParser` parses `<p id="x" hidden>`, `hidden=""` and `hidden="hidden"` (used by `check:dist`, task 12.3).
    - Fallbacks to record: if `PointerEvent` drops fields, build a plain `Event` and `Object.defineProperty` the fields through a helper `firePointer(el, type, init)` that task 9.4 adds; if `getComputedStyle` ignores `hidden`, assert the `hidden` attribute instead and leave computed `display` to the optional CSS test (9.6).
    - Write the outcome (what works, what fails, fallback chosen) to `.kiro/specs/voice-input/spike-dom.md`.
    - _Requirements: 4.1, 4.12, 4.13, 4.15, 4.17, 4.18, 2.8, 18.12_

  - [x] 1.2 Verify the fake `SpeechRecognition` shape and the capture-stub approach
    - Scratch test: write the `FakeSpeechRecognition` shape planned for `tests/voice/support/fake-recognition.ts` (records property writes; `start()` throws `InvalidStateError` when started and not ended; `emitStart`, `emitResult`, `emitError`, `emitEnd`; optional `phrases` support; `FakeSpeechRecognitionPhrase`) and check it can be installed on `globalThis` and `window` in both the node and the happy-dom environment and removed again.
    - Check whether TypeScript 7.0.2's DOM lib declares `SpeechRecognition` and `webkitSpeechRecognition`, and confirm the adapter's own structural types (names starting with `SpeechRecognitionLike`) compile without them.
    - Check that replacing `navigator.mediaDevices.getUserMedia`, `MediaRecorder`, `AudioContext.prototype.createMediaStreamSource` (only when `AudioContext` exists), `XMLHttpRequest`, `WebSocket`, `EventSource` and `navigator.sendBeacon` with throwing stubs through `Object.defineProperty` with `configurable: true` in a scratch setup file does not break Vitest 5.1.0 or happy-dom internals: run the whole existing suite once with the scratch setup file registered, then remove it. Confirm `AudioContext` itself is not replaced.
    - Fallbacks to record: if a stub breaks Vitest or happy-dom, drop only that stub, keep `fetch` (already guarded) and the capture stubs, and record which one was dropped; the matching static scan (task 13.4) then covers it.
    - Write the outcome to `.kiro/specs/voice-input/spike-fakes.md`. Never run a command that reaches the network.
    - _Requirements: 18.1, 18.2, 3.5, 3.8_

  - [x] 1.3 Verify fast-check usage and the Damerau-Levenshtein approach
    - Scratch test: confirm the exact fast-check 4.10.2 API forms to use: `fc.assert(fc.property(...), { numRuns: 100, seed, verbose: 1 })`; how to generate arbitrary strings with lone surrogates and non-ASCII (`fc.string({ unit: 'binary' })` or the 4.x equivalent), bounded long strings (10,000 characters), `fc.constantFrom`, `fc.array`, `fc.oneof`, `fc.option`, `fc.tuple`, and that the failure report prints the seed. Record the exact forms in the note so later tasks do not guess.
    - Write the optimal-string-alignment function `damerauLevenshtein` and the linear `isDistanceOne` as scratch code. Check exhaustively over the alphabet `{a, b, c}` and lengths 0 to 5 that `isDistanceOne(a, b) === (osa(a, b) === 1)`, and that OSA equals unrestricted Damerau-Levenshtein (a separate scratch implementation) whenever either distance is at most 1.
    - Fallback to record: if any mismatch appears, production uses `damerauLevenshtein(a, b) === 1` (token lengths are small) and the fast function is dropped; Property 6 then compares the DP with the unrestricted model.
    - Write the outcome to `.kiro/specs/voice-input/spike-pbt.md`.
    - _Requirements: 10.5, 18.3_

  - [x] 1.4 Record repo facts and the baseline
    - Read-only checks, recorded in `.kiro/specs/voice-input/spike-repo.md`: (a) `lookupWord('xyzzy')` from `src/shared/vocabulary.ts` resolves to a motion whose id equals the `XYZZY` constant of `src/data/constants.ts`, how `xyzzyx` and `go xyzzy` resolve (first five characters, at most two words via `scanWords`); (b) `isMetaWord` accepts `QUIT`, `SAVE`, `RESUME`, `SEED`, `WASTE` and their vocabulary spellings; (c) the signature of `isClassicCommandText` (not needed by the Voice_Layer, DD-4); (d) how `tests/ui/win430.test.ts` builds the controller (seed `HARNESS_DEFAULT_SEED`, `FakeClock`, options) and how the score is read from the `game-over` event; (e) the existing text of `public/_headers`, the sentence "Later specs (microphone) may add a `Permissions-Policy`." in `README.md`, the existing `PRIVACY_STATEMENTS` in `scripts/check-dist.ts`, the `makeDist` helper in `tests/scripts/check-dist.test.ts`, and which files the "mentions no browser, timer, clock, random or network API" scan of `tests/ui-layering.test.ts` covers (is `src/ui/dom` exempt?); (f) where `src/main.ts` wires `createHauntedStartLoader`, `onGameStart` and the `requestAnimationFrame` loop; (g) the existing `tests/ui/support/fakes.ts` and `generators.ts` exports.
    - Baseline: run `npx vitest --run` and `npm run typecheck` and record any pre-existing failure. Record `git rev-parse HEAD` and `git status --short`; this commit is `VOICE_INPUT_BASE_COMMIT` for the frozen-path diff in the checkpoints and in the optional task 13.5. If the working tree is dirty, record it and use the last commit.
    - _Requirements: 12.2, 13.9, 13.10, 19.8_

  - [x] 1.5 Consolidate the spike results and the fallback plan
    - Merge `spike-dom.md`, `spike-fakes.md`, `spike-pbt.md` and `spike-repo.md` into `.kiro/specs/voice-input/spike-results.md` with a table: item, verified or not, result, fallback chosen, which later task is affected. Delete the four partial files and any scratch tests.
    - If a fallback changes the design, update the matching paragraph of `design.md` and note which tasks change. Do not change `requirements.md`; list any requirement wording that would need the user's approval and ask with `user_input` if a fallback depends on it.
    - _Requirements: 18.1, 18.2_

- [x] 2. Prerequisites for the code issues found by the design
  - [x] 2.1 Create the disclosure constant
    - `src/shared/voice-disclosure.ts` with no imports: `export const VOICE_DISCLOSURE_TEXT = "Speech is processed by your browser's speech service (from the maker of your browser). This game stores no audio.";` exactly as in the glossary. No other module defines this text. The DOM module does not import it (DD-6); `index.html` carries the same static text (task 9.2).
    - _Requirements: 14.4, 16.5_

  - [x] 2.2 Change the layering test for the voice and haunt rule
    - Edit `tests/ui-layering.test.ts` as in the design: split the test "src/ui and src/main.ts import nothing from src/haunt, src/voice, src/shared or src/parse-api" so that (1) `src/ui` imports nothing from `src/voice`, `src/haunt` or `src/parser` by static import, `import type` or dynamic `import()`, and still nothing from `src/shared` or `src/parse-api`; (2) `src/main.ts` has no static import (including `import type`) of `src/voice`, `src/haunt` or `src/parser`, and imports `src/shared` and `src/parse-api` in no form; (3) a planted in-memory fixture shows that a dynamic `import("../voice/browser")` in a file under `src/ui` fails rule (1) while the same import in `main.ts` passes rule (2).
    - Keep every other test of that file unchanged. The file must pass before `main.ts` changes (no voice import exists yet).
    - If the "mentions no browser, timer, clock, random or network API" scan covers `src/ui/dom`, note that `mic-button.ts` needs `setTimeout` for the announcement re-arm; the design injects `defer`, so the default `setTimeout` must live in `main.ts` or be exempted in the way the existing DOM files are. Use the finding from task 1.4.
    - _Requirements: 18.9, 13.7_

  - [x] 2.3 Add the no-microphone and no-network test setup
    - `tests/setup/no-capture.ts`: replace `navigator.mediaDevices.getUserMedia`, `MediaRecorder`, `AudioContext.prototype.createMediaStreamSource` (only if `AudioContext` exists; `AudioContext` itself is never replaced), `XMLHttpRequest`, `WebSocket`, `EventSource` and `navigator.sendBeacon` with throwing stubs through `Object.defineProperty` with `configurable: true`. `fetch` stays guarded by `tests/setup/no-network.ts`. Apply the stub subset recorded by the spike (task 1.2).
    - Register it in `vitest.config.ts` `setupFiles` next to `no-network.ts`; keep every other setting.
    - `tests/setup/no-capture.test.ts` (node) and `tests/setup/no-capture-dom.test.ts` (happy-dom docblock): each stub throws; `AudioContext` is untouched when present.
    - Run the whole suite to confirm no existing test used these APIs.
    - _Requirements: 18.2, 14.1_

  - [x] 2.4 Extend the `check-dist` fixture helper
    - In `tests/scripts/check-dist.test.ts` extend only `makeDist` so the default fixture is compliant with the new checks: `index.html` with one hidden `#mic-disclosure` whose text equals `VOICE_DISCLOSURE_TEXT` (import the constant), a `_headers` file that passes the policy, a start script without `SpeechRecognition`, and a lazily loaded `assets/*.js` chunk that contains it; credits bundle text with the new phrases. Add override keys so later tests can break each piece. Do not edit any existing assertion; the existing tests must still pass with the old `check-dist.ts` (the new files are simply ignored by it).
    - _Requirements: 16.4, 16.5, 16.6, 16.7_

  - [x] 2.5 Create the shared voice test support
    - `tests/voice/support/pbt.ts`: `VOICE_SEED = 20261031` and `voiceAssert(property, runs = 100)` using `{ numRuns, seed: VOICE_SEED, verbose: 1 }` (use the exact forms recorded in task 1.3).
    - `tests/voice/support/fake-scheduler.ts`: `FakeScheduler` with `now()`, `setTimer`, `clearTimer`, `advance(ms)` firing due timers in due-time order at their due times. No real time.
    - `tests/voice/support/fake-permissions.ts`: `query` returning a status object with settable `state` and `onchange`; can be made to reject or throw.
    - `tests/voice/support/fake-recognition.ts`: `FakeSpeechRecognition` and `FakeSpeechRecognitionPhrase` as verified in task 1.2, with an `install(target)`/`uninstall()` pair and counters for constructions and `start` calls.
    - _Requirements: 18.1, 18.3_

- [x] 3. Pure voice modules and their tests (`src/voice`)
  - [x] 3.1 Create `config.ts`, `messages.ts` and `speech-provider.ts`
    - `src/voice/config.ts`: `MIN_HOLD_MS` 250, `MAX_LISTEN_MS` 10000, `RESULT_WAIT_MS` 3000, `STATUS_CLEAR_MS` 4000, `PREVIEW_MAX_CHARS` 80, `MAX_ALTERNATIVES` 5, `MAGIC_ALTERNATIVES_CHECKED` 3, `MAGIC_TOP_TOKEN_LIMIT` 4, `REPEATED_ERRORS_BEFORE_HIDE` 3, `SPOKEN_TEXT_MAX_CHARS` 200, `MAGIC_PHRASES` (`xyzzy plugh plover fee fie foe foo`), `PHRASE_BOOST` 3. No `DEFLECTION_LIMIT` here (DD-5).
    - `src/voice/messages.ts`: the fixed strings of the design (`LISTENING...`, `NOTHING HEARD.`, `DIDN'T CATCH THAT.`, `TYPE THE FILE NAME.`, `TYPE THAT COMMAND; DO NOT SAY IT.`, `VOICE IS NOT AVAILABLE. KEEP TYPING.`, `NO MICROPHONE FOUND. KEEP TYPING.`, `THE VOICE SERVICE IS NOT ANSWERING. TRY AGAIN OR TYPE.`, `VOICE TROUBLE. TYPE INSTEAD.`, prefixes `HEARD: ` and `Heard: `). None contains ERROR, FAILED, DENIED, DANGER, WARNING, SYSTEM, "exception", "crash" or "fatal" in any case.
    - `src/voice/speech-provider.ts`: `VoiceErrorCode`, `ProviderCallbacks`, `StartOptions`, `SpeechProvider` with the callback-order contract in comments. No `SpeechRecognition*` identifier here.
    - _Requirements: 3.1, 3.2, 3.9, 3.13, 7.9, 7.10_

  - [x] 3.2 Implement `clean.ts`
    - `cleanTranscript(input: unknown): string` in the order of Requirement 8.1: coerce non-strings to `''`; `normalizePlayerText` (from `src/shared/normalize.ts`); map U+2018, U+2019, U+02BC to `'` and U+2010 to `-`; lower case; replace each run outside `[a-z0-9' -]` with one space; collapse spaces; trim; cut to 200 characters; trim. One pass per step, no backtracking regex, total and idempotent. Port nothing from C.
    - _Requirements: 8.1, 8.2, 6.3_

  - [x] 3.3 Implement `edit-distance.ts`
    - `damerauLevenshtein(a, b)` (optimal string alignment, the reference model) and `isDistanceOne(a, b)` (linear, early length exit), or the fallback recorded by task 1.3.
    - _Requirements: 10.5_

  - [x] 3.4 Create the alias table, Stop_List, lead-ins, corpus and near-words helper
    - `src/voice/magic-aliases.ts`: the Magic_Alias_Table of the design (data only, source not generated; keys are canonical commands), `STOP_LIST` (at least 30 words, starting from the design list), `LEAD_INS` (longest first). To avoid an import cycle, the alias index (aliases run through the matcher tokenizer, so `x y z z y` is stored as `xyzzy`) is built in `magic-match.ts` (task 3.5), not here.
    - `tests/voice/support/ordinary-words.ts`: `ORDINARY_WORDS`, at least 200 ordinary English words including `plush`, `plum`, `plus`, `plug in`, `plough`, `flush`, `fizzy`, `dizzy`, `fuzzy`, `clover`, `lover`, `lovers`, `free`, `feet`, `fee's`, `few`, `fly`, `fool`, `food`, `for`, `four`, `fun`, `fur` and every `STOP_LIST` word.
    - `scripts/voice-near-words.ts`: developer helper (not run by `npm test`) that generates all strings at distance 1 from `xyzzy`, `plugh` and `plover`, optionally filters them with `--dict <file>`, and prints the survivors for a human to add to `STOP_LIST` and `ORDINARY_WORDS`. Offline only. Use it (without `--dict` if no word list exists) to review the list, and make sure every corpus word with five or more letters at distance 1 from a canonical word is in `STOP_LIST`.
    - _Requirements: 10.3, 10.11, 10.14_

  - [x] 3.5 Implement `magic-match.ts`
    - `tokenize` (split on spaces and hyphens, join runs of two or more single-letter tokens), `stripLeadIn` (at most one, longest first, lead-in alone gives no match), the alias index, and `matchMagicWords(alternatives: readonly unknown[]): MagicMatch | null` exactly as in the design: top-token limit on the first Alternative, first-match-wins over the first three Alternatives with `alternativeIndex`, alias tier before edit tier within an Alternative, whole-run alias, single token (exact alias, then `'s`/`s` strip only for aliases of five or more letters, then the edit tier for `/^[a-z]{5,}$/` tokens not in `STOP_LIST` at distance 1 from `xyzzy`, `plugh` or `plover`), and the FEE FIE FOE FOO sequence for runs of 2 to 4 tokens (prefixes of two or three allowed, any other shape gives null; runs of five or more give null). No fuzzy rule for tokens of four or fewer letters, tokens inside a run, or FEE, FIE, FOE, FOO. Inputs are coerced with `cleanTranscript`. No clock, randomness or I/O; never throws.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.17, 10.18, 11.1, 11.2, 11.3, 11.8, 11.9_

  - [x] 3.6 Implement `yes-no.ts` and `final-result.ts`
    - `mapYesNo(cleaned)` (whole-string comparison: `yes yeah yep yup sure ok okay affirmative` and `no nope nah negative`).
    - `decideFinal(alternatives, host: HostSnapshot): FinalOutcome` with the check order of the design table: (a) silent when phase is not `ready`, any host field is undefined, or mode is not `haunted`; (b) `TYPE_FILE_NAME` at a `filename` prompt; (c) `DIDN'T CATCH THAT.` when the first cleaned Alternative has no `[a-z0-9]`; (d) at `yesno`: yes/no mapping from the first Alternative only, else the Meta block on the first two space-separated tokens (`isMetaWord` from `src/shared/meta-commands.ts`), else the cleaned text unchanged, and the matcher is never called; (e) at `command`: `matchMagicWords`, with `heard` cleaned from the matching Alternative; (f) Meta block; (g) the lower-case cleaned text of the first Alternative. The Voice_Layer reads no engine state and defines no second Meta list.
    - _Requirements: 8.3, 8.4, 8.11, 8.12, 9.1, 9.2, 9.3, 9.5, 9.6, 9.7, 9.9, 9.12, 10.9, 10.16, 11.7_

  - [x] 3.7 Create the matcher and decision generators
    - `tests/voice/support/generators.ts`: arbitraries for dirty and cleaned transcripts, alias variants (upper case, trailing period, surrounding whitespace, one lead-in), token runs, alternative lists (0 to 10 elements, strings and non-strings), Meta-word lines, and host snapshots (including undefined fields). Use the fast-check forms recorded in task 1.3.
    - _Requirements: 18.3_

  - [x] 3.8 Write property test for cleaning
    - File `tests/voice/properties/p01-cleaning.test.ts`. Also assert `SPOKEN_TEXT_MAX_CHARS` equals `TEXT_MAX_CHARS` of `src/shared/limits.ts`.
    - **Property 1: Cleaning is total, bounded, normalized and idempotent**
    - **Validates: Requirements 8.1, 8.2, 6.3**

  - [x] 3.9 Write the alias-table, Stop_List and corpus example tests
    - Files `tests/voice/magic-aliases.test.ts` and `tests/voice/stop-list.test.ts`: the minimum content of Requirement 10.3 (at least four aliases each for XYZZY, PLUGH and PLOVER); no alias is a Game_Vocabulary word except the nine exceptions (`xyzzy`, `plugh`, `plove`, `plover`, `fee`, `fie`, `foe`, `foo`, `fum`), checked with `lookupWord` over every motion, object and action word of `src/data`; `STOP_LIST.length >= 30` with the required words; the corpus has at least 200 words including the 10.14 words; every corpus word of five or more letters at distance 1 from a canonical word is in `STOP_LIST`; `matchMagicWords([w])` is null for every corpus word and stop word; no stop word is an alias; `xyzzy xyzzy`, `xyzzy plugh`, `go xyzzy`, `zizzy please` give no match.
    - _Requirements: 10.3, 10.11, 10.14, 10.17, 18.3_

  - [x] 3.10 Write property test for matcher totality and determinism
    - File `tests/voice/properties/p02-matcher-total.test.ts`.
    - **Property 2: The matcher is total and deterministic**
    - **Validates: Requirements 10.1, 10.2**

  - [x] 3.11 Write property test for alias recognition
    - File `tests/voice/properties/p03-alias-variants.test.ts`.
    - **Property 3: Alias recognition survives its variants**
    - **Validates: Requirements 10.3, 10.4, 10.7, 10.12**

  - [x] 3.12 Write property test for the Magic_Sequence
    - File `tests/voice/properties/p04-magic-sequence.test.ts`.
    - **Property 4: The Magic_Sequence is accepted exactly in order, as a whole or as a prefix**
    - **Validates: Requirements 10.17, 10.18, 11.1, 11.2, 11.3, 11.6, 11.8**

  - [x] 3.13 Write the ordinary-vocabulary test
    - File `tests/voice/properties/p07-ordinary-words.test.ts`: an exhaustive test over a finite set (every Game_Vocabulary word except the nine exceptions, every corpus word, every `STOP_LIST` word), not a sampled one.
    - **Property 7: Ordinary words never match**
    - **Validates: Requirements 10.11, 10.13, 10.14**

  - [x] 3.14 Write property test for the final-result decision order
    - File `tests/voice/properties/p09-final-decision.test.ts`. Compare `decideFinal` with an independent reference table written in the test.
    - **Property 9: The final-result decision follows the fixed check order**
    - **Validates: Requirements 8.3, 8.4, 8.11, 8.12, 9.1, 9.2, 9.3, 9.5, 9.6, 9.9, 9.12, 10.16, 11.7**

  - [x] 3.15 Write the final-result and yes/no example tests
    - File `tests/voice/final-result.test.ts`: every yes and no word; `yes please` is not `yes` and is submitted unchanged; an unlisted yes/no answer is submitted unchanged; the filename block with no line; each of `QUIT`, `SAVE`, `RESUME`, `SEED`, `WASTE` withheld in the first two tokens at `command` and `yesno` prompts; a Meta word later in a longer sentence is passed on (and `validateCommand` rejects it on the AI path); the Magic_Match wins over a classic command; prompt kind and phase are read from the snapshot at decision time (a snapshot changed between two calls gives different outcomes).
    - _Requirements: 9.1, 9.2, 9.3, 9.5, 9.6, 9.8, 9.10, 10.8, 18.6_

  - [ ]* 3.16 Write edit-distance tests
    - Files `tests/voice/properties/p06-distance-model.test.ts` (**Property 6: The fast distance check agrees with the model**, small alphabet, **Validates: Requirements 10.5**) and `tests/voice/edit-distance.test.ts` (transposition, insertion, deletion, substitution, equal strings).

  - [ ]* 3.17 Write property test for the edit tier
    - File `tests/voice/properties/p05-edit-tier.test.ts`.
    - **Property 5: The edit tier obeys its boundaries**
    - **Validates: Requirements 10.5, 10.6**

  - [ ]* 3.18 Write property test for Alternative selection
    - File `tests/voice/properties/p08-alternative-selection.test.ts`.
    - **Property 8: Alternative selection is first-match-wins within the first three**
    - **Validates: Requirements 10.8, 11.8, 11.9**

  - [ ]* 3.19 Write cleaning example tests
    - File `tests/voice/clean.test.ts`: `plover's`, curly apostrophes, hyphens, accents, empty and 10,000-character input.
    - _Requirements: 8.1, 8.2_

- [x] 4. Checkpoint - pure voice modules
  - Run `npx vitest --run` and `npm run typecheck`. Confirm no file under `src/voice` imports `src/ui` or `src/parser`. Run `git diff --stat <VOICE_INPUT_BASE_COMMIT> -- src/engine src/data src/parser original reference` and confirm it is empty. Ensure all tests pass, ask the user if questions arise.

- [x] 5. Seams in `src/ui`
  - [x] 5.1 Add `InputOrigin`, `ResolveContext.origin` and `voice-port.ts`
    - `src/ui/types.ts`: `export type InputOrigin = 'typed' | 'spoken';`.
    - `src/ui/input-resolver.ts`: `ResolveContext` gains `origin?: InputOrigin`. No file in `src/parser` changes.
    - `src/ui/voice-port.ts` (types only): `VoiceAvailability`, `VoiceViewState`, `PointerKind`, `VoiceGestureEvent`, `GestureReply`, `VoicePort`, `VoiceLayer`, `VoiceLayerHost` as in the design (no `isClassicCommand`, DD-4).
    - _Requirements: 13.1, 13.2, 13.7, 19.2_

  - [x] 5.2 Add the input gate to `extension-hooks.ts`
    - `GateResult`, `InputGate`, `addInputGate(fn)` (disposer idempotent and identity-safe; each registration wrapped in its own entry object) and `gateInput(text, origin, deflections, ctx)`: returns allow without calling any gate when `ctx.gameMode !== 'haunted'`; iterates a copy of the list in registration order and stops at the first valid deflect; a gate that throws, returns a Promise or returns anything other than allow or a deflect with 1 to 3 non-empty strings is logged through `Logger.error` and treated as allow; the returned deflect is a fresh frozen copy.
    - _Requirements: 13.3, 13.4_

  - [x] 5.3 Add the autosave `ui` field
    - `src/ui/autosave.ts`: export `DEFLECTION_LIMIT = 1`; `encodeAutosave` and `storeAutosave` take `deflections = 0` and append `ui: { deflections }` as the last key only when it is greater than 0, inside the line-dropping size loop; `decodeAutosave` reads `ui` after all existing checks and returns `deflections` (0 for an absent or non-object `ui`, or a `deflections` that is not an integer from 0 to the limit; unknown keys ignored; the record is never rejected for `ui`); `Restored` gains `deflections`; `v` stays 1. With 0 the JSON is byte-identical to the pre-feature encoding. Engine `serialize` and `GameState` are untouched.
    - _Requirements: 13.11, 13.12, 13.15_

  - [x] 5.4 Add the controller seams to `game-controller.ts`
    - Queue entries become `{ line, origin }`; `submit(raw, origin: InputOrigin = 'typed')` treats any value other than `'spoken'` as `typed`; `idleCheck` and `startFresh` use the new entry type. `Resolution` carries `origin` through `beginResolution`, `onResolved`, `onResolveFailed`, the watchdog path and `startFresh` to `deliver`. `resolveContext(origin)` sets `origin` for every `needsTranslation` and `translate` call.
    - `processLine(line, origin)`: typed is unchanged; spoken calls `pushLine` as for typed, then restores `pos` and `draft` from the history state before the push, adjusting `pos` by the number of entries dropped by the 100-entry cap (clamped to 0). `history.ts` is unchanged (its `HistoryState` fields are already readable). The controller never touches the input element's value, caret or focus.
    - `deliver(line, text, origin)`: after `transformInput`, call `hooks.gateInput(transformed, origin, this.deflections, this.ctx())`. On deflect, `applyDeflection(lines)`: `deflections = Math.min(DEFLECTION_LIMIT, deflections + 1)`, emit each line as kind `narrator` (with a trailing newline, as other narrator lines), then `persistAutosave()`; do not call `step`, do not call `accepted()`. Lines handled before `deliver` (the `NEW` line in the `over` phase) are not gated.
    - Extract `persistAutosave()` from the tail of `present()` (passing the Deflection_Count to `storeAutosave`); `present()` calls it too. `newGameStart()` sets `deflections = 0`; the restore branch of `beginGame()` sets it from the decoded value. Engine `SAVE`/`RESUME` and reincarnation never touch it.
    - Add the getter `promptKind` (`undefined` when no game is running); `phase` and `gameMode` already exist. `onGameStart` is unchanged.
    - With no gate installed, transcript, autosave bytes and engine output stay identical to before. Run the existing UI and engine suites.
    - _Requirements: 8.5, 8.9, 8.13, 12.3, 12.6, 12.14, 12.15, 12.16, 12.17, 13.1, 13.2, 13.5, 13.6, 13.9, 13.13, 13.14, 13.15_

  - [x] 5.5 Extend `tests/ui/support` for origin, gates and failing stores
    - Additive changes only to `tests/ui/support/fakes.ts` and `generators.ts` (use the exports recorded in task 1.4): a fake resolver that records `ctx.origin` and can be scripted; a key-value fake whose `set` can be made to fail; a helper that builds a controller with optional gates, an initial Deflection_Count and a seed; arbitraries for origin and for a pool of typed and spoken lines. Existing exports keep their behavior and every existing test passes unchanged.
    - _Requirements: 13.9, 18.8, 18.14_

  - [x] 5.6 Write the gate registry example tests
    - File `tests/ui/gate-hooks.test.ts`: registration order, first deflect wins and later gates are not called, invalid results (zero lines, four lines, empty string entry, non-array, Promise, throw) are logged and treated as allow, mode gating (no gate called outside `haunted`), the same function registered twice and disposed twice removes only its own registration, a gate added or removed during evaluation does not affect it, the returned deflect is frozen.
    - _Requirements: 13.3, 13.4_

  - [x] 5.7 Write the autosave `ui` example tests
    - File `tests/ui/autosave-ui.test.ts`: encoding with count 0 is byte-identical to a stored pre-feature string and has no `ui` key; a record without `ui`, with a non-object `ui`, and with `deflections` equal to `-1`, `2`, `1.5`, `"1"` and `NaN` decodes with count 0 and is not rejected; unknown keys inside `ui` are ignored; count 1 round-trips; the size-limit loop includes `ui`. All existing autosave tests pass without an edit.
    - _Requirements: 13.11, 18.14_

  - [x] 5.8 Write property test for the autosave round trip
    - File `tests/ui/properties/p20-autosave-roundtrip.test.ts`.
    - **Property 20: The autosave round-trips the Deflection_Count and every other field**
    - **Validates: Requirements 13.11, 13.12, 13.15**

  - [x] 5.9 Write the controller origin example tests
    - File `tests/ui/controller-origin.test.ts`: `submit` default is `typed`; any value other than `'spoken'` becomes `typed`; `ResolveContext.origin` is set for `needsTranslation` and `translate`; a gate sees `spoken` for spoken lines and `typed` for typed ones; the gate runs on every `deliver` path (plain, AI translated, AI failed, watchdog, state changed) and not on the `NEW` line; `promptKind` is `undefined` before a game; a typed and a spoken line interleaved are delivered in submission order; with no gate and no layer the transcript is identical to the pre-feature behavior.
    - _Requirements: 8.9, 13.1, 13.2, 13.5, 13.6, 13.9_

  - [ ]* 5.10 Write property test for the gate registry
    - File `tests/ui/properties/p17-gate-registry.test.ts`.
    - **Property 17: The gate registry honours its contract**
    - **Validates: Requirements 13.3, 13.4**

  - [ ]* 5.11 Write property test for tolerant `ui` decoding
    - File `tests/ui/properties/p21-autosave-bad-ui.test.ts`.
    - **Property 21: Autosave decoding tolerates a bad `ui` field**
    - **Validates: Requirements 13.11**

  - [ ]* 5.12 Write property test for delivery order and origin
    - File `tests/ui/properties/p23-order-and-origin.test.ts`.
    - **Property 23: Delivery follows submission order and keeps the origin**
    - **Validates: Requirements 8.9, 12.17, 13.1**

  - [ ]* 5.13 Write the history cursor test and property
    - Files `tests/ui/properties/p24-history-cursor.test.ts` (**Property 24: A spoken line leaves the history cursor and draft alone**, **Validates: Requirements 8.13**) and `tests/ui/history-spoken.test.ts` (a spoken line keeps `pos` and `draft`, including at the 100-entry cap; entries equal those of a typed line).

- [x] 6. Spoken_Word_Rule in `src/haunt`
  - [x] 6.1 Implement `src/haunt/spoken-word-rule.ts`
    - `DEFLECTION_LINE = 'SAY IT ALOUD. HOLD THE MIC OR ALT+M. TYPE XYZZY AGAIN IF YOU MUST.'` (66 characters), `DEFLECTION_LIMIT = 1`, `containsXyzzyMotionWord(text)` (via `scanWords` and `lookupWord` from `src/shared/vocabulary.ts`, motion with canonical `XYZZY`), `decideSpokenWord(...)` (deflect iff haunted, `command` prompt, voice usable, origin typed, XYZZY motion word present and `deflections < DEFLECTION_LIMIT`), and `createSpokenWordGate({ isVoiceUsable })`. It declares its own structural types for the gate; it imports nothing from `src/ui`, `src/voice` or `src/parser`. Spoken lines and the words PLUGH, PLOVER, FEE, FIE, FOE, FOO are never deflected; the text given to `step` is never changed.
    - _Requirements: 12.1, 12.2, 12.4, 12.5, 12.7, 12.8, 12.10, 12.11_

  - [x] 6.2 Write the Spoken_Word_Rule example tests
    - Files `tests/haunt/spoken-word-rule.test.ts` (exact `DEFLECTION_LINE`, 66 characters, contains `ALOUD`, `MIC` and `ALT+M`, at most 80; deflected: `xyzzy`, `XYZZY`, `go xyzzy`, `say xyzzy`, `plugh xyzzy`; not deflected: spoken origin, other magic words, non-`command` prompts, availability `Unsupported`, `Unavailable`, `Suspended`, Mode_1976), `tests/haunt/xyzzy-id.test.ts` (for each deflected example `lookupWord(w).id` equals the `XYZZY` constant of `src/data/constants.ts`) and `tests/haunt/constants-sync.test.ts` (`DEFLECTION_LIMIT` of `src/haunt` equals the one in `src/ui/autosave.ts`).
    - _Requirements: 12.1, 12.2, 12.4, 12.7, 12.8, 12.10, 18.8_

  - [x] 6.3 Write property test for the Input_Gate iff rule
    - File `tests/haunt/properties/p18-gate-iff.test.ts`: drive the real `createSpokenWordGate` through `ExtensionHooks.gateInput` and a real `GameController` for the queued-lines part.
    - **Property 18: The Spoken_Word_Rule deflects exactly when its conditions hold**
    - **Validates: Requirements 12.1, 12.2, 12.5, 12.7, 12.8, 12.10, 12.17, 13.13**

  - [x] 6.4 Write the controller Deflection example tests
    - File `tests/ui/controller-deflection.test.ts` with the real gate and a stub layer whose usability can change: a typed XYZZY is deflected exactly once per game; transcript and history hold the typed line and exactly one `narrator` line equal to `DEFLECTION_LINE`, no `original` line, a Translation_Line may precede it for an AI-translated line; `serialize` output and the RNG state are byte-identical before and after (no turn, no random number); the autosave is written right after the Deflection and carries `ui.deflections` 1; after a following `LOOK` and the let-through XYZZY the autosave still carries `ui`; a restore from that autosave keeps 1 so the next typed XYZZY is not deflected; a restore of an autosave without `ui` gives 0; the count resets to 0 on boot, the restart offer, a mode change that starts a game and an invalid or cleared autosave, and is not changed by engine `SAVE`/`RESUME` or by reincarnation; a failing `kv.set` still shows the line and keeps the in-memory count; a change to `Unavailable` during a game stops deflection from that moment, including for lines already queued; several queued typed XYZZY lines deflect only the first; a spoken XYZZY (exact command, Magic_Match, AI translation) is never deflected; the Deflection_Line is identical in two games.
    - _Requirements: 12.3, 12.4, 12.5, 12.6, 12.9, 12.14, 12.15, 12.16, 12.17, 13.14, 18.8_

  - [ ]* 6.5 Write property test for transparency of a Deflection
    - File `tests/haunt/properties/p19-deflection-transparent.test.ts`.
    - **Property 19: A Deflection is transparent to the engine**
    - **Validates: Requirements 12.3, 12.14, 13.13, 13.14**

- [x] 7. Checkpoint - UI seams and haunt rule
  - Run `npx vitest --run` and `npm run typecheck`. Confirm the whole pre-existing suite passes without edits other than those allowed in the rules. Confirm `git diff --stat <VOICE_INPUT_BASE_COMMIT> -- src/engine src/data src/parser original reference` is empty. Ensure all tests pass, ask the user if questions arise.

- [x] 8. Voice shell: adapter, session machine, controller, detection, browser entry
  - [x] 8.1 Implement `web-speech-adapter.ts`
    - The only file with `SpeechRecognition*` or `webkitSpeechRecognition` identifiers. `createWebSpeechProvider(callbacks, win)` with its own structural types (`SpeechRecognitionLike...`); constructor preference (unprefixed, then `webkitSpeechRecognition`, by `typeof === 'function'`); `probe()` constructs and discards one object (a throw propagates); `start(options)` throws if a session runs, builds a fresh object per session, sets `lang = 'en-US'`, `continuous = false`, `interimResults = true`, `maxAlternatives = MAX_ALTERNATIVES` and ignores any such key in `options`, applies `phrases` only when `SpeechRecognitionPhrase` and `"phrases" in recognition` exist, and rethrows a throwing `rec.start()` after clearing the session; events check session identity first (stale events dropped); `result` handling (final with 1..5 alternatives to `onFinal` once, empty final remembered as no result, interim text from the best transcripts joined by a space, later results ignored); `error` through `mapRecognitionError` (total, exact table of Requirement 3.4, non-string to `other`), first error delivered once, `phrases-not-supported` retried once without phrases and not delivered; `end` gives `onError('no-speech')` when neither final nor error was delivered, then `onEnd()`; `stop()` and `abort()` never throw and are ignored when idle, and `abort()` detaches the session so no callback follows; `isSupported()` has no side effects and requires `isSecureContext === true`. No audio is read or stored.
    - _Requirements: 3.3, 3.4, 3.5, 3.6, 3.7, 3.9, 3.10, 3.11, 3.12, 3.13, 14.1_

  - [x] 8.2 Implement `session-machine.ts` (pure)
    - Types from the design (`Session`, `VoiceState`, `VoiceEvent`, `VoiceEffect`, `ReduceContext`) and `reduce(state, event, ctx) -> { state, effects }` implementing the full transition table and the error table: mouse and pen press start on `pointer-down`; touch pointer events are ignored in every state and only the touch `button-activate` acts (latch toggle, no MIN_HOLD_MS); keyboard `button-activate` and `altm-down` (not repeat); hold versus latch at 250 ms; a stop-press sets `swallowRelease` for a pointer press only; `p-final` processed once through `decideFinal`; one error per session; `p-end`; timers `maxListen`, `resultWait` (also the end guard), `startConfirm`, `statusClear`; `start-threw` gives a runtime `Unavailable` with `VOICE IS NOT AVAILABLE. KEEP TYPING.` and the counter unchanged; `denied`, `no-device` and `unsupported-language` give a runtime `Unavailable`; `network` and `other` increment the counter and hide at the third in a row; `no-speech` and a processed final reset it; `aborted` is silent; `game-start` aborts and sets `suspended`; `host-changed` aborts on phase not `ready` or `filename`; `permission` events (ignored while suspended); derived `availabilityOf(state)` with `suspended` as an independent flag (DD-8). No clock, I/O or provider access: time comes from `ctx.now`.
    - _Requirements: 1.4, 1.5, 1.11, 2.5, 2.14, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.14, 4.16, 4.17, 4.18, 4.19, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 5.12, 6.2, 6.3, 6.5, 6.7, 6.10, 6.11, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.13, 7.14, 7.16, 7.17_

  - [x] 8.3 Implement `session-controller.ts` (the shell)
    - `createVoiceLayer({ host, provider factory, scheduler, env, log })` returning `VoiceLayer`: a run-to-completion event queue; `dispatch(event)` reads `ctx = { now, host snapshot }` at the moment the event is processed (so `onFinal` reads prompt kind and phase at that moment), calls `reduce`, executes effects in order (`provider-start` whose throw becomes a `start-threw` event, `provider-stop`, `provider-abort`, `timer-set`/`timer-clear` tagging fired events with session id and status sequence, `submit(lines)` as a synchronous loop of `host.submit(line, 'spoken')`, `log(code)` as one `host.log.error('voice: ' + code)` with the code only), then publishes the `VoiceViewState` and the `listening` change. `gameStart(mode)` runs detection once (task 8.4) the first time the mode is haunted, then dispatches `game-start`; `syncHost()` enqueues `host-changed` only when `(phase, promptKind, gameMode)` changed; `usable`, `listening`, `subscribe(listener)` (one synchronous call per change, none when unchanged, disposer, a throwing listener is caught). Passes `{ phrases: MAGIC_PHRASES }` on every start. Never calls `getUserMedia`, never starts during initialization. Imports no adapter module (the provider is injected).
    - _Requirements: 1.4, 1.5, 2.7, 2.11, 2.12, 3.8, 5.9, 7.12, 8.10, 8.11, 9.10, 19.2, 19.3_

  - [x] 8.4 Implement `detect.ts`
    - `detectEnvironment(env)` (runs once): `!env.isSecureContext || !env.hasRecognition()` gives `unsupported` with no further call; `env.probe()` throwing gives runtime `Unavailable` with one `log('other')`; otherwise ready immediately. `env.queryMicrophone` is called by the shell inside `try/catch`; a rejection, throw or unsupported name is ignored; on `denied` the shell enqueues `permission('denied')` and keeps the `PermissionStatus` for `change` events. Feature test only: no user-agent sniffing. Returns its own small result type so it does not depend on `session-machine.ts`.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.11, 2.12, 2.13_

  - [x] 8.5 Implement `browser.ts`
    - `createBrowserVoiceLayer(host)`: real `globalThis.isSecureContext` and `navigator.permissions`, `performance.now()` and `setTimeout`/`clearTimeout` as the scheduler, `createWebSpeechProvider(callbacks, globalThis)` as the provider factory. This is the dynamic-import target of `src/main.ts`.
    - _Requirements: 1.3, 3.8_

  - [x] 8.6 Create the shell test support
    - `tests/voice/support/fake-provider.ts` (conforming `FakeSpeechProvider`: callback order, detach on abort, scripted emitters, call log, configurable `start` throw), `tests/voice/support/fake-host.ts` (mutable `promptKind`, `phase`, `gameMode`; records `submit(line, origin)` in order; counting `log`), `tests/voice/support/session-generators.ts` (arbitraries for the event sequences of Property 10, including `pointerType` mouse, pen and touch, touch click, Alt+M with `repeat`, Enter/Space, Escape, blur, visibility, pagehide, provider interim/final/error/end, start throwing, clock advances of 0 to 20,000 ms, new game, switch to 1976, host changes).
    - _Requirements: 18.1, 18.4_

  - [x] 8.7 Write the adapter example tests
    - File `tests/voice/web-speech-adapter.test.ts` with `FakeSpeechRecognition`: property writes (`lang`, `continuous`, `interimResults`, `maxAlternatives`) and options ignored; constructor preference; `isSupported()` without construction; the full error mapping table (`not-allowed` and `service-not-allowed` to `denied`, `audio-capture`, `network`, `no-speech`, `language-not-supported`, `aborted`, and missing, number, object, `undefined`, `null` to `other`); phrases supported, unsupported, throwing and the `phrases-not-supported` retry; final with 0, 1, 5 and 8 alternatives; end without result gives `no-speech` then end; late events after `abort` or end are dropped; second `start` while running throws and leaves the session unchanged; idle `stop` and `abort` do nothing; a throwing `rec.start()` is rethrown with the session cleared.
    - _Requirements: 3.4, 3.5, 3.6, 3.7, 3.9, 3.10, 3.11, 3.12, 3.13_

  - [x] 8.8 Write the detection example tests
    - File `tests/voice/detect.test.ts` with counting fakes: the matrix of Requirements 2.1 to 2.7 and 2.11 to 2.13 (insecure context, no constructor, probe throws, permission `denied` and later `granted`, permission query rejecting or unsupported, no `start` call and no `getUserMedia` during init, detection runs once across game starts, Ready shown without waiting for the query, a Firefox-like user agent with the API shows the button, a browser without the API shows neither), and `Unsupported` makes zero calls to the constructors, `permissions.query` and `getUserMedia`.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.11, 2.12, 2.13_

  - [x] 8.9 Write the session lifecycle example tests
    - File `tests/voice/session-lifecycle.test.ts` with `FakeSpeechProvider`, `FakeScheduler` and `FakeHost`: hold versus latch at 249 and 250 ms for `mouse` and `pen`; a touch pointer press and release start nothing; a touch click starts a latch session and the next stops it, one `start` per tap; first press starts without any notice or second press for mouse, touch click, keyboard and Alt+M; `stop` at 9999 and 10000 ms of `MAX_LISTEN_MS`; `abort`, no line and `NOTHING HEARD.` at 2999 and 3000 ms after `stop`, and a final at 2999 ms still delivered; start-confirm at 12999 and 13000 ms ends as `VOICE TROUBLE. TYPE INSTEAD.`; the status clears at 3999 and 4000 ms; `Busy` returns to `Ready` within 100 ms of the end event; a result after an abort is discarded; a final while still held is processed without a new session and the later release calls neither `stop` nor `abort`; Escape inert when idle; a game start and a switch to Mode_1976 abort without a line or message; host phase change and `filename` prompt abort; the session runs with a fake provider without importing the adapter; a Magic_Match submits 1 to 4 lines in order, in one task, with one announcement.
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.16, 4.17, 4.18, 4.19, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.12, 6.5, 8.10, 10.9, 11.4, 14.8, 18.16, 3.8_

  - [x] 8.10 Write the error and start-failure example tests
    - File `tests/voice/session-errors.test.ts`: every message row of Requirements 7.1 to 7.6 (text, resulting availability, no transcript line, one announcement, one console entry with only the code); `not-allowed`, `service-not-allowed` and `language-not-supported` end in `Unavailable` with the Mic_Button and the Voice_Disclosure hidden (view state) for the rest of the page lifetime; a `start` that throws synchronously on the first mouse press, touch click, keyboard activation and Alt+M ends in `Unavailable`, shows only `VOICE IS NOT AVAILABLE. KEEP TYPING.`, leaves the counter unchanged, logs one `other`, and no later start request calls `start` again; a browser that exposes the API but denies it ends the same way; a runtime `Unavailable` survives a 1976 game and a later Haunted game start; a permission-based `Unavailable` is reversed only by `granted` or `prompt` and not while suspended; the three-in-a-row rule with the reset by a processed final; every message satisfies the word rule of Requirement 7.10; no console call contains Spoken_Text; no `KeyValueStore` key is read or written other than the autosave key during a full session (first press, result, error); typed lines are unaffected by every error.
    - _Requirements: 2.14, 5.8, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.10, 7.12, 7.13, 7.17, 14.8, 14.9, 14.12, 18.6, 18.13_

  - [x] 8.11 Write property test for session safety
    - File `tests/voice/properties/p10-session-safety.test.ts`.
    - **Property 10: Session safety invariants hold for every event sequence**
    - **Validates: Requirements 2.14, 4.2, 4.3, 4.4, 4.5, 4.8, 4.9, 4.10, 4.14, 4.16, 4.17, 4.18, 4.19, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.11, 6.4, 6.11, 7.12, 7.14, 7.17, 8.10, 8.11**

  - [ ]* 8.12 Write property test for the availability model
    - File `tests/voice/properties/p11-availability-model.test.ts`.
    - **Property 11: Availability follows the model**
    - **Validates: Requirements 1.4, 1.5, 1.11, 2.5, 2.12, 2.13, 2.14, 7.1, 7.2, 7.8, 7.17**

  - [ ]* 8.13 Write property test for the failure counter
    - File `tests/voice/properties/p12-failure-counter.test.ts`.
    - **Property 12: The failure counter follows its rules**
    - **Validates: Requirements 7.7, 7.13, 7.17**

  - [ ]* 8.14 Write property test for the status timeline
    - File `tests/voice/properties/p13-status-timeline.test.ts`.
    - **Property 13: Status and announcements follow the timeline**
    - **Validates: Requirements 6.3, 6.5, 6.7, 6.10, 6.12, 7.16, 10.10, 11.9, 17.7**

  - [ ]* 8.15 Write property test for adapter callback order
    - File `tests/voice/properties/p14-adapter-order.test.ts`.
    - **Property 14: The adapter delivers callbacks in contract order and drops stale events**
    - **Validates: Requirements 3.6, 3.9, 3.10, 3.11, 3.13**

  - [ ]* 8.16 Write property test for error mapping
    - File `tests/voice/properties/p15-error-mapping.test.ts`.
    - **Property 15: Recognition error mapping is total and exact**
    - **Validates: Requirements 3.4**

  - [ ]* 8.17 Write property test for listening subscriptions
    - File `tests/voice/properties/p25-listening-subscribe.test.ts`.
    - **Property 25: Listening subscriptions behave as specified**
    - **Validates: Requirements 19.2, 19.3**

- [x] 9. DOM module, markup and CSS
  - [x] 9.1 Implement `src/ui/dom/mic-button.ts`
    - `installMicButton({ els, doc, defer })` returning `{ attach(port), dispose() }`, structurally typed against `src/ui/voice-port.ts`; imports nothing from `src/voice`, `src/haunt`, `src/parser` or `src/shared`. Until `attach` every element stays hidden and every listener does nothing. If a required element is missing it installs nothing and returns a no-op handle.
    - Rendering in one synchronous pass: `button.hidden` and `disclosure.hidden` change together; if the button is about to be hidden while it has focus, first call `input.focus({ preventScroll: true })` (input value, caret and selection unchanged); `aria-pressed`, `aria-disabled`, `aria-describedby` (`mic-disclosure`, then `mic-unavailable` while disabled), the label `MIC` or `MIC ON`; Voice_Status via `textContent` and `hidden`; Voice_Live_Region from `announcement` with the identical-text re-arm through the injectable `defer` (`ANNOUNCE_REARM_MS = 50`).
    - Listeners as in the design: `pointerdown` (primary button 0; record `prev` and `pressType`; `preventDefault` for every type; dispatch `pointer-down`; `setPointerCapture` for mouse and pen when present and in `try/catch`); a `mousedown` `preventDefault`; `pointerup`; `pointercancel` (clears the touch state); `lostpointercapture` without a preceding `pointerup` for mouse and pen; `click` (`detail === 0` is `button-activate` via keyboard; `detail > 0` after a touch press is `button-activate` via touch, then restore focus to the input when it was there; `detail > 0` after mouse or pen is ignored; `pressType` reset after every click); `contextmenu` (`preventDefault`, clears `pressType`); document `keydown` for Alt+M (`code === 'KeyM'`, `altKey`, no ctrl, meta or shift; `preventDefault` always, also on repeat, while `Ready` or `Busy`) and Escape only while `pressed`; `keyup` of `KeyM` or `Alt`; `window` `blur`, `visibilitychange` (hidden) and `pagehide`. Text only through `textContent` and attributes; no `innerHTML`, no `style` attribute, no timer other than the injected `defer`.
    - _Requirements: 2.8, 2.9, 4.1, 4.4, 4.5, 4.6, 4.7, 4.10, 4.11, 4.12, 4.13, 4.14, 4.15, 4.17, 4.18, 4.19, 6.1, 7.15, 14.5, 14.6, 17.1, 17.3, 17.4, 17.6, 17.7, 17.9_

  - [x] 9.2 Add the markup to `index.html` and test the disclosure text
    - After the `.input-line` block add `#voice-bar` with `<button id="mic" class="mic" type="button" hidden aria-pressed="false" aria-keyshortcuts="Alt+M" aria-label="Mic: hold to talk" aria-describedby="mic-disclosure">MIC</button>`, `<p id="voice-status" class="voice-status" aria-hidden="true" hidden></p>`, `<p id="mic-disclosure" class="voice-disclosure" hidden>` containing exactly the text of `VOICE_DISCLOSURE_TEXT` (no child markup, no `aria-hidden`), and `<span id="mic-unavailable" hidden>Voice input is not available for this question</span>`; after `#live-interpreted` add `<div id="voice-live" class="sr-only" aria-live="polite" aria-atomic="true"></div>`. No `style` attribute.
    - `tests/shared/voice-disclosure.test.ts`: the `#mic-disclosure` text of the source `index.html` equals the constant (parse with a happy-dom `DOMParser`), its length is at most 140, it contains `browser's speech service`, `maker of your browser` and `stores no audio`; the accessible name `Mic: hold to talk` contains the visible label `MIC` and the whole words "hold" and "talk"; `#voice-live` is neither an ancestor nor a descendant of `#live` or `#live-interpreted`, is `aria-live="polite"` and `aria-atomic="true"`, and is empty.
    - _Requirements: 4.11, 14.4, 14.6, 16.5, 17.3, 17.11, 18.13_

  - [x] 9.3 Add the "Voice input" block to `src/ui/crt.css`
    - Tokens `--voice-text: var(--fg)`, `--voice-border: var(--fg-dim)`, `--voice-target: 44px`, and the rules of the design: `.voice-bar` (flex, wrap, `min-width: 0`), `.voice-bar [hidden] { display: none !important; }`, `.mic` (44 by 44 minimum, `touch-action: manipulation`, `user-select: none`, `-webkit-user-select: none`, `-webkit-touch-callout: none`, 2px border), `.mic[aria-pressed="true"]` inverted, `.mic[aria-disabled="true"]` dashed border, `.voice-status` and `.voice-disclosure` with `overflow-wrap: anywhere` and `white-space: normal`. New text uses `--fg`, not `--fg-dim`. No animation or transition on any new element; extend the existing `prefers-reduced-motion` block with `.mic, .voice-status { animation: none !important; transition: none !important; }`. The focus ring is the existing `:focus-visible` rule.
    - _Requirements: 4.12, 6.8, 6.9, 14.7, 17.1, 17.4, 17.5, 17.6, 17.10_

  - [x] 9.4 Write the core DOM tests for the Mic_Button
    - File `tests/ui/dom/mic-button.test.ts` (happy-dom docblock as in the existing DOM tests) with a fake `VoicePort`; use the `firePointer` helper from the spike fallback if the spike found one is needed. Cover: the exhaustive view-state table (5 availabilities, pressed, disabled): button and disclosure `hidden` together, `aria-pressed`, `aria-disabled`, `aria-describedby` order (`mic-disclosure` first), label, `aria-keyshortcuts`, no `aria-hidden` on the disclosure, `aria-hidden` on the status; mouse and pen hold at 249 and 250 ms dispatch the expected events; a touch `pointerdown` and `pointerup` dispatch events and start nothing; a touch `click` after a touch `pointerdown` dispatches exactly one `button-activate` (`via: 'touch'`) and the next dispatches one more; a `click` with `detail > 0` after a mouse press is ignored; `click` with `detail` 0 is a keyboard activation; `contextmenu` is default-prevented; `preventDefault` on pointer press for every type and on a touch `mousedown`; the input's focus, value and selection are unchanged after a pointer press and after a touch click; Alt+M `keydown` is default-prevented (also on repeat) and Ctrl, Meta and Shift variants are ignored; start-failure hiding: when the view becomes `Unavailable` while the button has focus, the button and the disclosure are hidden together in one pass and focus moves to the input with value, caret and selection unchanged; with an unattached port and with a missing element nothing throws and typing is unaffected.
    - _Requirements: 2.8, 2.9, 4.1, 4.2, 4.3, 4.12, 4.13, 4.15, 4.17, 4.18, 4.19, 7.15, 14.5, 17.9, 18.12_

  - [ ]* 9.5 Write the additional DOM edge-case tests
    - File `tests/ui/dom/mic-button-edge.test.ts`: Escape dispatch only while pressed and no `preventDefault` otherwise; `keyup` of `KeyM` and `Alt`; blur, visibility and pagehide events; `pointercancel` clears the touch state; `lostpointercapture` without `pointerup` for mouse and pen only; `setPointerCapture` missing or throwing is tolerated; identical consecutive announcements are re-armed with an injected `defer`; the input value, caret and selection are unchanged by a whole session; the disclosure is shown in every state including disabled.
    - _Requirements: 4.5, 17.7, 18.12_

  - [ ]* 9.6 Add the contrast helper and CSS tests
    - `tests/support/contrast.ts` (reads hex tokens from `crt.css`, `dimmedColor(fg, 0.22, 0.96)`, `contrastRatio`) and `tests/ui/voice-css.test.ts`: `crt.css` has the tokens and rules (44px, `touch-action: manipulation`, the `[hidden]` override, `overflow-wrap`, `flex-wrap`, the reduced-motion guard) and the contrast helper gives at least 4.5:1 for text and 3:1 for borders and the focus colour in the ready, listening and disabled states. The required DOM tests do not need this helper.
    - _Requirements: 14.7, 17.1, 17.5_

- [x] 10. Composition in `src/main.ts`
  - [x] 10.1 Implement `voice-loader.ts` and `game-start-fanout.ts`
    - `src/voice-loader.ts`: `VoiceModule`, `HauntModule`, `VoiceLoaderDeps` and `createVoiceStartLoader(deps)` returning `{ onGameStart(mode), syncHost() }` with structural types only. It records the latest mode; loads both chunks with `Promise.all` on the first Haunted game start (never in 1976, at most one load at a time, a successful load kept); on resolve creates the layer, calls `onLayer`, then runs the normal path with the latest mode (a 1976 game that started during the load leaves the layer suspended with no gate and no detection); on reject logs one `log.error` entry with no spoken text and retries at the next Haunted game start; registers `createSpokenWordGate({ isVoiceUsable: () => layer.usable })` through `host.addInputGate` when entering Haunted and disposes it when entering 1976, synchronously before the first line of that game. Never awaited on the game path.
    - `src/game-start-fanout.ts`: `createGameStartFanOut(handlers, log)` calls every handler in order, each inside its own `try/catch`, logging failures only. `src/ai-loader.ts` is unchanged.
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 1.8, 1.9, 1.10, 13.8_

  - [x] 10.2 Wire voice into `src/main.ts`
    - `loadVoiceModule = () => import('./voice/browser')` and `loadHauntModule = () => import('./haunt/spoken-word-rule')`; `installMicButton` with the found elements (`#mic`, `#voice-status`, `#mic-disclosure`, `#mic-unavailable`, `#voice-live`, the input) installed at startup in every mode; `createVoiceStartLoader` with a `getHost` that adapts the controller (`submit`, `promptKind`, `phase`, `gameMode`, `addInputGate` through the hook registry, `log`) and `onLayer: (l) => mic.attach(l.port)`; fan the single game-start notification out to `createHauntedStartLoader` and the voice loader with `createGameStartFanOut`; call `voice.syncHost()` once per frame in the existing `requestAnimationFrame` loop. No static import of `src/voice`, `src/haunt` or `src/parser`, and nothing awaited on the game path (the first prompt and typed input never wait for the import).
    - Run `tests/ui-layering.test.ts`, then `npm run build` (local, offline) and confirm the voice layer is a separate chunk that contains `SpeechRecognition` while the start script does not.
    - _Requirements: 1.2, 1.3, 1.6, 1.7, 1.9, 13.6, 13.8_

  - [x] 10.3 Write the loader and fan-out tests
    - Files `tests/voice/voice-loader.test.ts` and `tests/ui/game-start-fanout.test.ts`: the first Haunted start loads once, never in 1976, independently of the AI loader; a restored Mode_1976 game triggers no load and a restored Haunted game does; a mode change during a game triggers nothing; while the import promise is pending (including never settling) the first prompt is shown and typed lines are accepted and answered; a 1976 start during a pending load leaves the layer suspended with no gate; a failed load is logged once, shows nothing, leaves typing working and is retried at the next Haunted start; the gate is registered on entering Haunted and removed on entering 1976 before the first prompt; a throwing handler never prevents the other from running.
    - _Requirements: 1.3, 1.6, 1.7, 1.8, 1.9, 1.10, 13.8, 18.11_

  - [ ]* 10.4 Write property test for the loader lifecycle
    - File `tests/voice/properties/p16-loader-lifecycle.test.ts`.
    - **Property 16: The voice loader obeys its lifecycle**
    - **Validates: Requirements 1.1, 1.3, 1.5, 1.8, 1.10, 2.12, 13.8**

- [x] 11. Checkpoint - voice layer, DOM and composition
  - Run `npx vitest --run`, `npm run typecheck` and `npm run build`. Confirm the voice code is not in the start script and `git diff --stat <VOICE_INPUT_BASE_COMMIT> -- src/engine src/data src/parser original reference` is empty. Ensure all tests pass, ask the user if questions arise.

- [x] 12. Headers, build checks, README and credits
  - [x] 12.1 Add the Permissions-Policy header
    - In `public/_headers` append exactly one line `  Permissions-Policy: microphone=(self)` to the existing `/*` block. Every other line stays byte-identical (the CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`). No second path block.
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_

  - [x] 12.2 Implement `scripts/headers-policy.ts`
    - `parseHeadersFile(text)` returns blocks `{ pattern, headers: { name, value }[] }` (a non-indented, non-comment line starts a block; indented `Name: value` lines belong to it; `#` starts a comment). `checkHeadersPolicy(text)` returns a list of failures naming the problem, never the values of secrets: exactly one `/*` block with exactly one `Permissions-Policy` whose value is exactly `microphone=(self)`; exactly one Content-Security-Policy parsed by `;` with `default-src 'self'`, `connect-src 'self'`, `img-src 'self' data:`, `style-src 'self'`, `font-src 'self'`, `frame-ancestors 'none'`, no source starting with `http:`, `https:`, `ws:`, `wss:` or `*`, no `'unsafe-inline'` or `'unsafe-eval'`, `data:` only in `img-src`, only `'self'` in `script-src`, `media-src` and `connect-src`; `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer` present; no second block repeating `Permissions-Policy`, `Content-Security-Policy` or `X-Content-Type-Options` (DD-10).
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.8, 15.9_

  - [x] 12.3 Extend `scripts/check-dist.ts`
    - `PRIVACY_STATEMENTS` gains `e`: `['voice input', 'speech recognition service', 'maker of the browser', 'never records or stores audio']`, `f`: `['1976 mode never uses the microphone']`, `g`: `['typing always works']`; entries `a` to `d` unchanged. New checks, all reported in one run without printing header or credential values and without modifying `dist/`: `dist/index.html` has exactly one element with id `mic-disclosure`, with a `hidden` attribute in any serialization, whose text after entity decoding and whitespace collapsing equals `VOICE_DISCLOSURE_TEXT` (import the constant; parse with the happy-dom `DOMParser`); `dist/_headers` exists (a missing file is reported by name) and passes `checkHeadersPolicy`; no script that `dist/index.html` loads at start (`<script src>` or `<link rel="modulepreload" href>`) contains `SpeechRecognition`, and at least one `.js` under `dist/assets` does.
    - _Requirements: 16.4, 16.5, 16.6, 16.7, 16.10_

  - [x] 12.4 Update `README.md`
    - Add a section with the heading text exactly "Voice input": how to use the Mic_Button, Alt+M, tap-to-latch (mouse, pen, Alt+M) and tap-to-toggle on touch; supported browsers (tested in Chrome, Edge and Safari; the button shows wherever the API exists and hides for the rest of the page session after a denied or unusable start); the XYZZY rule, the once-per-game hint (`DEFLECTION_LIMIT`), that the next typed XYZZY works and that the game is completable without a microphone; the privacy disclosure including `VOICE_DISCLOSURE_TEXT` verbatim and that the first press starts listening with the browser prompt as the consent step; the headers (`Permissions-Policy: microphone=(self)`, `_headers` covers static assets only and not the Functions under `/api`, the Vite dev server does not apply `_headers`, the CSP needs no new origin); the not-verified list of Requirement 15.10. Use the phrases "voice input uses the speech recognition service" of the "maker of the browser", audio is sent to that service, "never records or stores audio", "1976 mode never uses the microphone" and "typing always works".
    - Replace the sentence "Later specs (microphone) may add a `Permissions-Policy`." in the `public/_headers` paragraph with text that names `Permissions-Policy: microphone=(self)`. Extend the "Manual checklist (real devices)" section with items (a) to (k) of Requirement 16.8, each with an expected result and marked "not verified". Add a short place to record findings (Requirement 15.7).
    - _Requirements: 12.12, 14.10, 15.6, 15.7, 15.10, 16.1, 16.2, 16.8, 16.11_

  - [x] 12.5 Update `CREDITS.md`
    - Append the section "Voice input and privacy" from the design, each phrase on a single source line without markup or quotes inside it (so `check:dist` finds it in the bundled string): the speech recognition service of the maker of the browser, audio sent to it, this site never records or stores audio, 1976 mode never uses the microphone, typing always works. Existing sections unchanged. `credits.html` needs no edit.
    - _Requirements: 14.10, 16.3_

  - [x] 12.6 Write the headers parse test
    - File `tests/scripts/headers-policy.test.ts`: the real `public/_headers` passes; mutated copies each fail with a named message: `microphone=()`, `microphone=*`, `microphone=(*)`, a quoted origin, an extra directive, `'unsafe-inline'`, an `http:` source, a missing `connect-src`, a missing `frame-ancestors 'none'`, a second block repeating a header, a duplicated `Permissions-Policy`. The test parses the file (no substring search) and runs without a browser.
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.8, 15.9_

  - [x] 12.7 Write the `check-dist` tests
    - Extend `tests/scripts/check-dist.test.ts` (new tests only, using the extended `makeDist`): a clean build passes; each failure in its own test on a modified temporary dist: the credits bundle lacks any phrase of entries `e`, `f`, `g`; `maker of your browser` does not satisfy `maker of the browser`; `dist/index.html` lacks the disclosure text, lacks the `hidden` attribute, has two `#mic-disclosure` elements, or has a different apostrophe; `dist/_headers` is missing, lacks `Permissions-Policy: microphone=(self)`, contains `microphone=()` or `microphone=*`, `unsafe-inline`, `unsafe-eval`, an `http:` or `https:` origin, or lacks `default-src 'self'`, `connect-src 'self'`, `frame-ancestors 'none'` or the `X-Content-Type-Options: nosniff` line; `SpeechRecognition` appears in a script referenced directly by `index.html`, or in no file under `dist/assets`. Every failure of one run is reported together, no values are printed and `dist/` is not modified.
    - _Requirements: 16.4, 16.5, 16.6, 16.7, 16.10, 18.17_

  - [x] 12.8 Write the README test
    - File `tests/repo/readme-voice.test.ts`: the section "Voice input" exists and contains `Alt+M`, `Permissions-Policy: microphone=(self)` and `VOICE_DISCLOSURE_TEXT` verbatim (imported); the removed sentence is gone; the checklist items (a) to (k) are present and marked "not verified"; the required phrases of Requirement 14.10 are present; the README states that `_headers` does not apply to the Functions or the Vite dev server.
    - _Requirements: 12.12, 14.10, 15.6, 16.1, 16.2, 16.8, 16.9_

  - [ ]* 12.9 Write the credits test
    - File `tests/ui/credits-voice.test.ts`: `buildCreditsText()` and `CREDITS.md` contain every phrase of Requirement 14.10, and the existing sections are unchanged.
    - _Requirements: 14.10, 16.3_

- [x] 13. Integration, isolation and static tests
  - [x] 13.1 Write the 1976 isolation tests
    - File `tests/ui/voice-isolation.test.ts`: with counting fakes for the chunk loaders, the recognition constructors, `navigator.permissions.query` and `getUserMedia`, a 1976 game (and a restored 1976 autosave) makes zero calls to all of them, loads no chunk, keeps the Mic_Button and the Voice_Disclosure `hidden`, leaves the Voice_Status and Voice_Live_Region empty, registers no gate, and a typed XYZZY reaches the engine unchanged; with the layer loaded, a Haunted-to-1976 transition aborts any session without a line, hides both, clears both text elements and removes the gate before the first prompt; a 1976 start during a pending load stays suspended; `src/main.ts` references the voice and haunt modules only through `import()`. Replaying a 1976 upstream log with the loader installed is byte-identical to without.
    - _Requirements: 1.1, 1.2, 1.4, 1.6, 1.10, 2.10, 8.11, 12.8, 18.11_

  - [x] 13.2 Write the three-run win430 replay
    - File `tests/ui/voice-win430.test.ts`: replay `reference/open-adventure/tests/win430.log` through `GameController` in Haunted mode with the upstream seed and options and the injected clock (as `tests/ui/win430.test.ts` does): (1) without the Voice_Layer; (2) with the layer installed and availability `Unavailable`, typed XYZZY; (3) with a fake provider that speaks every `xyzzy`, `plugh`, `plover`, `fee`, `fie`, `foe` and `foo` line as its own Voice_Session. Each run expects a final score of 430 read from the `game-over` event, a byte-identical `original` text sequence across the runs (echo lines excluded) and a Deflection_Count of 0 at the end. A fourth test uses a stub layer in `Ready`, types every XYZZY, types the first one twice, and expects 430 and exactly one Deflection.
    - _Requirements: 12.7, 12.11, 12.13, 17.8, 18.7_

  - [x] 13.3 Write the typed-versus-spoken equivalence property
    - File `tests/ui/properties/p22-typed-spoken-equivalence.test.ts` (a fixed sample of at least 20 Classic_Commands and sentences, scripted resolver, the single utterance `fee fie foe foo` against the four typed lines `fee`, `fie`, `foe`, `foo` with zero resolver requests).
    - **Property 22: Typed and spoken lines of the same text are equivalent**
    - **Validates: Requirements 8.5, 8.7, 11.5, 13.2, 18.15**

  - [x] 13.4 Write the voice layering and static scan tests
    - File `tests/voice/layering.test.ts`: `src/voice` and `src/haunt` import nothing from `src/ui`, `src/parser` or each other, and otherwise only `src/shared` and `src/engine`; `src/engine` imports nothing from them; `SpeechRecognition*` and `webkitSpeechRecognition` identifiers appear (outside comments and tests) only in `web-speech-adapter.ts`; `speechSynthesis`, `SpeechSynthesisUtterance`, `getUserMedia`, `MediaRecorder` and `createMediaStreamSource` appear nowhere under `src/voice`, `src/ui`, `src/haunt` or `src/main.ts`; no `localStorage`, `sessionStorage`, `indexedDB`, `document.cookie` or `KeyValueStore` use in `src/voice`; no `alert(`, `confirm(`, `prompt(` or `<dialog` in the voice and DOM modules; the module that exports `matchMagicWords` is not reachable by static imports from `src/parser`, `game-controller.ts`, `src/engine` or `src/main.ts`; the voice files use `isMetaWord` from `src/shared` and define no second Meta list; no Worker, `fetch` or storage use was added.
    - _Requirements: 3.3, 10.15, 14.13, 18.9, 18.10, 19.1, 19.4, 19.6, 19.9_

  - [ ]* 13.5 Write the frozen-paths test
    - File `tests/repo/frozen-paths.test.ts`: `git diff --quiet <VOICE_INPUT_BASE_COMMIT> -- src/engine src/data src/parser original reference`, skipped when git or the commit is unavailable; the constant comes from task 1.4.
    - _Requirements: 13.10, 19.8_

- [x] 14. Final checkpoint - everything green
  - Run `npx vitest --run`, `npm run typecheck`, `npm run build` and `npm run check:dist`. Run `git diff --stat <VOICE_INPUT_BASE_COMMIT> -- src/engine src/data src/parser original reference` and confirm it is empty. Ensure all tests pass, ask the user if questions arise. Remind the user that no deployment, login or network call was performed and that task 15 is theirs.

- [ ] 15. OWNER STEP - MANUAL, NOT EXECUTABLE BY THE AGENT (do not run, do not mark done on the owner's behalf)
  - The agent must skip this task. It needs the owner's Cloudflare account, publishes the site and needs real devices and browsers. Nothing here is run by any agent task, test or CI step, and no agent marks it done.
  - Steps for the project owner, in order (the README from task 12.4 repeats them):
    1. Build (`npm run build`, `npm run check:dist`) and deploy the site in the owner's own terminal with the owner's own login, as for the ai-parser deployment (for example `wrangler pages deploy dist`). Use a Pages preview first if preferred.
    2. Header manual check on the deployed URL: fetch the response headers of `/` and of a static asset (for example `curl -I https://<project>.pages.dev/`) and confirm `Permissions-Policy: microphone=(self)`, the unchanged Content-Security-Policy, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`, each exactly once. Confirm the `/api` Functions responses are not expected to carry them.
    3. Run the real-device checklist (a) to (k) of the README on Chrome and Edge desktop, Safari on macOS, Safari on iOS and Chrome on Android (and a Firefox build with the API, if one is available): first press or tap starts listening with the browser prompt, speech is recognized under the deployed CSP and Permissions-Policy, touch tap toggles once, long press shows no context menu, the on-screen keyboard stays up, the disclosure wraps at 320 CSS pixels without horizontal scrolling, a denied prompt hides the button calmly, 1976 mode shows no button and no prompt, a typed XYZZY is deflected once and the next works after a reload, Brave hides the button after three `network` errors, a very slow answer to the permission prompt ends with `VOICE TROUBLE. TYPE INSTEAD.`, and note which company processes the audio in each browser.
    4. Record every finding in the README checklist, changing "not verified" to "passed" or to the observed failure with browser and version. If the headers block recognition in Chrome, Edge or Safari (a `denied` or `network` first press although the prompt was accepted), record it and open a follow-up spec for the headers; the headers of this spec ship unchanged until then.
    5. Review the "Not verified" list of the design (Alt+M collisions, screen-reader behavior of the live region, `preventDefault` and the on-screen keyboard, pen activation, `phrases` biasing) and decide which findings need a follow-up.
  - _Requirements: 15.7, 15.10, 16.8, 16.11_

## Notes

- Tasks marked with `*` are optional and can be skipped. The required set alone delivers the complete feature with the tests listed in the overview: matcher alias, ordinary-vocabulary, sequence and totality properties with the alias-table and Stop_List example tests, cleaning, the final-result decision order, the session event-sequence property, the Input_Gate iff property and Spoken_Word_Rule examples, the autosave round trip, the three-run win430 replay, typed-versus-spoken equivalence, the layering and static tests, the 1976 isolation tests, the headers, `check-dist` and README tests, the no-network and no-microphone guard, and the core DOM tests.
- Each task references specific requirements for traceability. Checkpoints ensure incremental validation.
- No task logs in, deploys, touches the network, sets secrets or runs `wrangler`. Those steps are in task 15 and in the README.
- Property tests are in separate files under `tests/voice/properties/`, `tests/haunt/properties/` and `tests/ui/properties/` so tasks run in parallel. Tasks that write the same file are in different waves.
- The Voice_Layer never reads engine state: `isClassicCommand` is intentionally not part of `VoiceLayerHost` (DD-4).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4"] },
    { "id": 1, "tasks": ["1.5"] },
    { "id": 2, "tasks": ["2.1", "2.2", "2.3", "2.4", "2.5", "3.1", "3.3", "3.4", "5.1", "5.3", "12.1", "12.2", "12.5"] },
    { "id": 3, "tasks": ["3.2", "3.16", "5.2", "5.7", "5.8", "5.11", "6.1", "8.1", "8.4", "9.1", "9.2", "9.3", "12.3", "12.4", "12.6", "12.9"] },
    { "id": 4, "tasks": ["3.5", "3.8", "3.19", "5.4", "5.6", "5.10", "6.2", "8.7", "8.15", "8.16", "9.4", "9.5", "9.6", "10.1", "12.7", "12.8"] },
    { "id": 5, "tasks": ["3.6", "3.7", "3.9", "5.5"] },
    { "id": 6, "tasks": ["3.10", "3.11", "3.12", "3.13", "3.14", "3.15", "3.17", "3.18", "5.9", "5.12", "5.13", "6.3", "6.4", "6.5", "8.2", "10.3"] },
    { "id": 7, "tasks": ["8.3", "8.6"] },
    { "id": 8, "tasks": ["8.5", "8.8", "8.9", "8.10", "8.11", "8.12", "8.13", "8.14", "8.17", "10.4", "13.2", "13.3"] },
    { "id": 9, "tasks": ["10.2"] },
    { "id": 10, "tasks": ["13.1", "13.4", "13.5"] }
  ]
}
```
