# Implementation Plan: crt-terminal-ui

## Overview

This plan puts the existing Game_Engine behind a green-phosphor CRT terminal that runs in the browser and builds to a static site for Cloudflare Pages. It is typing only; voice, AI, narrator and haunting effects are later specs and only get typed extension points here.

Order of work:

1. A verification spike, before any UI code: the happy-dom docblock with the pinned Vitest, and a verbatim copy of the VT323 `OFL.txt` with its source URL.
2. Scaffolding: build and TypeScript config, the shared `types.ts`, and the test support (fakes and generators).
3. The pure, DOM-free modules in `src/ui/*.ts`, each followed by its tests: storage and settings, history, transcript and event rendering, Teletype and boot data, Autosave and Extension_Hooks.
4. The `GameController`, which ties the pure modules together, and the `win430` test that plays the full game through it.
5. The DOM glue in `src/ui/dom/*.ts`, `src/main.ts`, the CSS, `index.html` and the credits page.
6. Static layering tests, the build check, and the Cloudflare Pages preparation (CREDITS.md, `_headers`, `wrangler.toml`, `scripts/check-dist.ts`, README manual-deploy steps, GitHub Actions CI).

Language: TypeScript (strict). Tests run with `npx vitest --run` (single run, never watch mode). The engine is used only through `src/engine/index.ts`. `original/` and `reference/` are read-only. Existing tests (`tests/lint.test.ts`, `tests/fidelity.test.ts`, `tests/walkthrough.test.ts`, `tests/properties/*`) are not edited.

Rules that apply to every task:

- Pure modules directly under `src/ui/` must not mention `document`, `window`, `localStorage`, `sessionStorage`, `navigator`, `matchMedia`, `visualViewport`, `requestAnimationFrame`, `setTimeout`, `setInterval`, `Date` or `Math.random` in code. Browser access lives only in `src/ui/dom/` and `src/main.ts`.
- The DOM is written only with `textContent` or `Text` nodes. Never use `innerHTML`, `outerHTML` or `insertAdjacentHTML` under `src/ui`.
- No task runs `wrangler login`, `wrangler pages deploy` or any other deploy or publish command, and nothing in the repository holds Cloudflare credentials. The first deploy is done by the user following the README (Requirement 16.11).
- The only new dev dependency is `happy-dom` pinned exactly (or, only if the spike shows it does not load, `jsdom` pinned exactly). No new runtime dependency.
- Property-based tests use fast-check with at least 100 runs, one file per property under `tests/ui/properties/`, each tagged with a comment `// Feature: crt-terminal-ui, Property N: <title>`, so the files can run in parallel.
- The win430 check reads the score from the final `game-over` event (430). It never uses the last `score` event, which reads 426 because the end-of-game bonuses are only added into the `game-over` score.

Required versus optional: all implementation tasks are required. These tests are also required, because they guard the spec's core fidelity guarantees: Property 6 (Teletype reveal fidelity), Property 1 (event-render fidelity), Property 18 (Autosave round trip), Property 8 (history invariants), the `win430` UI test, and the layering test. The other property tests and the unit, DOM and config tests are optional (marked `*`).

## Tasks

- [x] 1. Verification spike (do this before any UI code)
  - [x] 1.1 Verify the happy-dom docblock works with the pinned Vitest
    - Install `happy-dom@21.0.4` as an exact-pinned dev dependency (no `^` or `~`). Confirm the version with `npm view happy-dom version` first and record it if it differs.
    - Create scratch tests `tests/ui/dom/spike.test.ts` (first line `// @vitest-environment happy-dom`; creates an element, sets `textContent`, asserts `typeof document === 'object'`) and `tests/ui/spike-node.test.ts` (asserts `typeof document === 'undefined'`).
    - Run `npx vitest --run` with the pinned Vitest. Check that the DOM test passes, that the Node test still sees no `document`, and that the existing engine tests are unaffected.
    - If the docblock is not honoured, apply the design's fallbacks in order: (1) a Vitest `projects` entry in `vitest.config.ts` that selects `tests/ui/dom/**/*.test.ts` with `environment: 'happy-dom'` next to the existing Node project; (2) `environmentMatchGlobs`, only if the installed Vitest still supports it; (3) pin `jsdom` at an exact version and use it the same way. Config-only changes; do not edit existing tests.
    - Delete both scratch tests. Write the outcome (which mechanism works, exact versions) to `.kiro/specs/crt-terminal-ui/spike-results.md`, and update the "DOM tests" paragraph of `design.md` if a fallback was needed.
    - _Requirements: 15.5, 15.7, 16.7_

  - [x] 1.2 Copy the VT323 font and its OFL.txt verbatim, record the source URL
    - Download `https://raw.githubusercontent.com/google/fonts/main/ofl/vt323/OFL.txt` byte for byte into `public/fonts/OFL.txt` (no editing, re-wrapping or line-ending conversion). Use a binary-safe download (for example `Invoke-WebRequest -OutFile`), then check `.gitattributes` does not convert it.
    - Verify it begins with the font's own copyright line and contains the heading `SIL OPEN FONT LICENSE Version 1.1`, and byte-compare it against a second fetch from the same URL.
    - Get `VT323-Regular.woff2` (latin, weight 400) from `@fontsource/vt323@5.3.0` using `npm pack @fontsource/vt323@5.3.0` in a temp directory, then copy the file to `public/fonts/VT323-Regular.woff2`. Do not add the package as a dependency. Remove the temp directory.
    - If the Google Fonts URL is unreachable, try the `OFL.txt`/`LICENSE` inside the `@fontsource/vt323@5.3.0` package. If neither source can be reached, STOP and ask the user with the `user_input` tool. Never reconstruct or retype the licence text from memory.
    - Record the chosen source URL (and package version if used) in `.kiro/specs/crt-terminal-ui/font-source.md`, for use when writing `CREDITS.md`.
    - _Requirements: 2.12, 2.15, 2.16, 16.7, 16.9_

- [x] 2. Scaffold build configuration, shared types and test support
  - [x] 2.1 Update build and TypeScript configuration
    - `tsconfig.json`: add `"DOM"` and `"DOM.Iterable"` to `lib`, add `"vite/client"` to `types`, and add `vite.config.ts` to `include`.
    - Create `vite.config.ts`: `base: '/'`, `build.outDir: 'dist'`, `rollupOptions.input = { main: 'index.html', credits: 'credits.html' }`. Read no `VITE_*` variable.
    - `package.json`: add scripts `dev` (`vite`), `build` (`npm run typecheck && vite build`), `preview` (`vite preview`), `check:dist` (`tsx scripts/check-dist.ts`); add `"engines": { "node": ">=22.12.0" }`. Keep every dependency pinned exactly.
    - Create `.node-version` containing `22`. Confirm `.gitignore` still excludes `node_modules/`, `dist/` and `.env*`.
    - Keep the vitest config result from task 1.1 intact.
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.7, 16.8_

  - [x] 2.2 Create `src/ui/types.ts`
    - Define `Mode`, `Speed`, `LineKind`, `TranscriptLine` (`kind`, `text`, `eol`), `KeyValueStore`, `Clock`, `MotionPreference`, `Logger`, `PromptInfo`, `TerminalPort` and `BlockMeta` as in the design.
    - Derive `PromptKind` as `Extract<OutputEvent, { type: 'prompt' }>['kind']` from the engine's public API (`src/engine/index`) only.
    - No browser globals in this file.
    - _Requirements: 1.5, 15.1_

  - [x] 2.3 Create test support under `tests/ui/support/`
    - `fakes.ts`: `FakeClock` (settable `now()`), `FakeTerminal` implementing `TerminalPort` and recording every call and every chunk (kept outside the 2000-line cap), `FakeMotion`, and a recording `Logger`.
    - `generators.ts`: fast-check arbitraries `arbOutputEvent` (all event types, all text channels, strings with `\n`, empty text, unicode), `arbTranscriptLine`, `arbSettings`, `arbCommandSequence` (a vocabulary of real commands such as `get lamp`, `enter`, `xyzzy`, `quit`, plus arbitrary strings up to 1023 chars), `arbHookList` (ok / throws / invalid return) and `arbTickSchedule` (monotone times with flush points). Reuse `tests/properties/generators.ts` where it fits, without editing it.
    - _Requirements: 15.1, 15.2, 15.3_

- [x] 3. Storage, settings and command history
  - [x] 3.1 Implement `src/ui/kv-store.ts` and `src/ui/save-store.ts`
    - `MemoryKeyValueStore`, and `ResilientStore(primary | undefined, onDegraded)` that serves keys from memory when the primary is missing or throws, calls `onDegraded` once, and never throws.
    - `SaveStore implements Storage` with `FILE_PREFIX = 'advent:file:'`, `AUTOSAVE_KEY`, `SETTINGS_KEY`, `HISTORY_KEY` (all outside the file prefix). `write` returns `false` when `set` throws; `read` returns `undefined` when absent or when `get` throws.
    - _Requirements: 9.7, 10.1, 10.2, 10.3, 10.4, 10.5_

  - [ ]* 3.2 Write property test for Save_Store
    - File `tests/ui/properties/p17-save-store.test.ts`.
    - **Property 17: Save_Store round trip and key namespace**
    - **Validates: Requirements 10.2, 10.4, 10.5, 10.8**

  - [ ]* 3.3 Write unit tests for the key-value stores
    - File `tests/ui/kv-store.test.ts`: a throwing store makes `SaveStore.write` return `false` (10.3); `ResilientStore` falls back to memory and raises the degraded notice exactly once (9.7); reserved keys never start with `advent:file:` (10.5).
    - _Requirements: 9.7, 10.3, 10.5_

  - [x] 3.4 Implement `src/ui/settings.ts`
    - `Settings`, `DEFAULT_SETTINGS` (`haunted`, 120, CRT on), `SPEED_CHOICES` (20, 60, 120, 300, `instant`), total `parseSettings` with per-field defaults, and `printSettings` as separate functions with a fixed key order. Reduced motion is never written into the record.
    - _Requirements: 6.2, 6.3, 11.2, 11.5, 13.1, 13.3, 13.5_

  - [ ]* 3.5 Write property test for settings round trip
    - File `tests/ui/properties/p11-settings-roundtrip.test.ts`.
    - **Property 11: Settings round trip**
    - **Validates: Requirements 13.4, 13.5**

  - [ ]* 3.6 Write property test for settings parsing
    - File `tests/ui/properties/p12-settings-parse.test.ts`.
    - **Property 12: Settings parsing is total and falls back per field**
    - **Validates: Requirements 11.2, 11.5, 13.3**

  - [x] 3.7 Implement `src/ui/history.ts`
    - Immutable `HistoryState` (`entries`, `pos`, `draft`), `MAX_HISTORY = 100`, `MAX_LINE = 1023`, `emptyHistory`, `pushLine` (non-empty, not equal to newest, cap 100, resets `pos`), `recallUp`, `recallDown`, and total `parseHistory` / `printHistory`.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.7, 8.8_

  - [x] 3.8 Write property test for history invariants
    - File `tests/ui/properties/p08-history-invariants.test.ts`.
    - **Property 8: Command history invariants**
    - **Validates: Requirements 8.1, 8.2, 8.4, 8.5, 8.9**

  - [ ]* 3.9 Write property test for history browsing round trip
    - File `tests/ui/properties/p09-history-browsing.test.ts`.
    - **Property 9: History browsing round trip**
    - **Validates: Requirements 8.3**

  - [ ]* 3.10 Write property test for history persistence
    - File `tests/ui/properties/p10-history-persistence.test.ts`.
    - **Property 10: History persistence round trip and rejection**
    - **Validates: Requirements 8.7, 8.8**

- [x] 4. Transcript and event rendering
  - [x] 4.1 Implement `src/ui/event-render.ts` and `src/ui/transcript.ts`
    - `originalTextOf(events)` = `render(events, { echo: false })`, `lastPromptOf(events)`, `splitIntoLines(text, kind)` and `joinLines(lines)` (a line carries an `eol` flag; text ending in `\n` yields no trailing empty partial line; `''` yields `[]`).
    - `Transcript` with `MAX_TRANSCRIPT_LINES = 2000`, `append` (trims oldest), `clear`, `lines`, `originalText` (depends only on `original` lines), and `tail(n, kinds?)`.
    - _Requirements: 5.1, 5.2, 5.4, 5.5, 5.8, 5.11, 12.4, 12.7_

  - [x] 4.2 Write property test for rendering fidelity
    - File `tests/ui/properties/p01-rendering-fidelity.test.ts`. Interleave appended `input`, `notice`, `narrator` and `boot` lines with engine output and check that the original lines never change.
    - **Property 1: Rendering fidelity and Original_Text immutability**
    - **Validates: Requirements 5.1, 5.2, 5.6, 5.8, 12.4, 12.7**

  - [ ]* 4.3 Write property test for the transcript cap
    - File `tests/ui/properties/p02-transcript-cap.test.ts`.
    - **Property 2: Transcript cap keeps the newest lines**
    - **Validates: Requirements 5.11**

  - [ ]* 4.4 Write unit tests for event rendering and the transcript
    - Files `tests/ui/event-render.test.ts` and `tests/ui/transcript.test.ts`: `splitIntoLines`/`joinLines` examples (no trailing newline, blank lines, empty text), cap at exactly 2000, `tail(200)` excludes `boot`.
    - _Requirements: 5.2, 5.11_

- [x] 5. Teletype and boot data
  - [x] 5.1 Implement `src/ui/teletype.ts`
    - Pure tick-driven scheduler: `enqueue(block, nowMs)`, `tick(nowMs)`, `flush()`, `busy`. Fractional budget so revealed count depends only on total elapsed time; rate re-read every tick; per-block `cps` override (boot uses 30); `pauseAfterMs` consumed from tick time and skipped by `flush()` and instant mode; slice by code point; `instant` or reduced motion reveals before `enqueue` returns but queues behind earlier pending blocks; `onRevealed` per block and `onIdle` once when empty.
    - _Requirements: 4.6, 4.10, 6.1, 6.4, 6.5, 6.6, 6.7, 6.9_

  - [x] 5.2 Write property test for Teletype reveal fidelity
    - File `tests/ui/properties/p06-teletype-fidelity.test.ts`. Vary speed (including `instant`), reduced-motion flag, tick schedule and flush point.
    - **Property 6: Teletype reveals exactly the output text**
    - **Validates: Requirements 4.10, 6.5, 6.6, 6.7, 6.9**

  - [ ]* 5.3 Write property test for Teletype rate
    - File `tests/ui/properties/p07-teletype-rate.test.ts`.
    - **Property 7: Teletype rate is independent of how time is sliced**
    - **Validates: Requirements 4.6, 6.1**

  - [x] 5.4 Implement `src/ui/boot-script.ts`
    - `BootLine`, `BOOT_CPS = 30`, `FULL_BOOT` (fake PDP-10 start-up lines, then `LOADING ADVENT ... FAILED`, `RETRYING AFTER 49 YEARS ...`, `RESURRECTING`), `SHORT_BOOT` (the last two lines only), `selectBoot(hasValidAutosave)` and `bootDurationMs`. Data only; no DEC, TOPS-10 or other trademarks.
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.11_

  - [ ]* 5.5 Write unit tests for boot data
    - File `tests/ui/boot-script.test.ts`: mandatory lines and order, `bootDurationMs(FULL_BOOT) <= 9000`, `1000 <= bootDurationMs(SHORT_BOOT) <= 2000`, `selectBoot`, deny-list of product names.
    - _Requirements: 4.4, 4.5, 4.7, 4.11_

- [x] 6. Autosave and Extension_Hooks
  - [x] 6.1 Implement `src/ui/autosave.ts`
    - `AutosaveRecord`, `AUTOSAVE_MAX_CHARS = 400000`, `AUTOSAVE_MAX_LINES = 200`, `encodeAutosave` (last 200 non-`boot` lines, drop oldest lines until under budget, `undefined` if the state alone does not fit), total `decodeAutosave` (valid shape, `deserialize` ok, `session.status === 'running'`), `loadAutosave` (deletes invalid entries), `storeAutosave`, `clearAutosave`.
    - _Requirements: 4.3, 9.1, 9.2, 9.3, 9.4, 9.9_

  - [x] 6.2 Write property test for Autosave round trip
    - File `tests/ui/properties/p18-autosave-roundtrip.test.ts`. Reach states with generated command sequences from any seed in both modes, restore through `decodeAutosave`, play further commands, and compare Original_Text and final serialized state with continuing the original state.
    - **Property 18: Autosave round trip**
    - **Validates: Requirements 9.2, 9.8**

  - [ ]* 6.3 Write property test for the Autosave size budget
    - File `tests/ui/properties/p19-autosave-budget.test.ts`.
    - **Property 19: Autosave respects its size budget**
    - **Validates: Requirements 9.1, 9.9**

  - [ ]* 6.4 Write property test for Autosave decoding
    - File `tests/ui/properties/p20-autosave-decode.test.ts`.
    - **Property 20: Autosave decoding is total**
    - **Validates: Requirements 9.3**

  - [x] 6.5 Implement `src/ui/extension-hooks.ts`
    - `ExtensionHooks` with the four registrations (input transformer, event observer, narrator-line provider, output listener; each returns an unregister function), typed `HookContext` (frozen per call), and the methods `transformInput`, `observeEvents`, `narratorLines`, `notifyOutput`. Every method first checks `ctx.gameMode === 'haunted'`. Handlers run in registration order; a handler that throws or returns a wrong shape is skipped and logged. Handlers get no reference to the Transcript.
    - _Requirements: 11.9, 11.11, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8_

  - [ ]* 6.6 Write property test for the hook pipeline
    - File `tests/ui/properties/p15-hook-pipeline.test.ts`.
    - **Property 15: Hook pipeline composes valid handlers and isolates faulty ones**
    - **Validates: Requirements 12.2, 12.6, 12.8, 12.9**

  - [ ]* 6.7 Write property test for 1976 mode isolation
    - File `tests/ui/properties/p16-no-hooks-1976.test.ts`.
    - **Property 16: No hook runs in 1976 mode**
    - **Validates: Requirements 11.9**

- [x] 7. Checkpoint - pure modules
  - Run `npx vitest --run` and `npm run typecheck`. Ensure all tests pass, ask the user if questions arise.

- [x] 8. GameController and the win430 test
  - [x] 8.1 Implement `src/ui/game-controller.ts`
    - `ControllerDeps` and `GameController` as in the design: phases `booting | ready | over | failed`; `startBoot` (Short or Full boot via `selectBoot(loadAutosave(...) !== undefined)`, enqueued as Teletype blocks with `cps: 30`); `skip`; `tick`; `submit` (queued while busy or booting; echo `prompt.text + raw` as an `input` line; `transformInput`; `step` in try/catch with notice `?SYSTEM ERROR - COMMAND IGNORED` that keeps the old state; enqueue `originalTextOf(events)`; game-over and SAVE notices; `observeEvents`; narrator lines as `narrator` blocks after the original block; update prompt; Autosave or clear; push `raw` into history; truncate programmatic input to 1023 chars); `history` helpers; `requestNewGame` (confirm, delete Autosave, clear, new seed from `clock.now() | 0`, New_Game_Start); `setMode`, `setSpeed`, `setCrt` writing the Settings_Record; `gameMode` from `session.settings.oldstyle`.
    - Begin game when the boot goes idle: restore a valid Autosave (restored lines instantly, `RESUMING SAVED SESSION`, restored prompt) or New_Game_Start with `newGame(seed, { oldstyle: mode === '1976' })` and `start`. Pass `env = { storage: new SaveStore(kv) }` to every engine call. After `game-over`, phase `over`: empty line, `NEW` or New game starts a new game; other input reprints the notice. `start` failure gives phase `failed` and `?SYSTEM ERROR - RELOAD THE PAGE`.
    - Use the exact notice strings from the design. Call `notifyOutput` and `view.announce` from `Teletype.onRevealed` for every non-`boot` block. Non-text events reach only `observeEvents`.
    - _Requirements: 1.4, 4.1, 4.2, 4.3, 4.8, 4.9, 4.12, 5.4, 5.5, 5.6, 5.7, 5.10, 6.8, 7.1, 7.2, 7.4, 7.6, 7.7, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 10.1, 10.6, 10.7, 11.3, 11.6, 11.7, 11.8, 11.10, 12.2, 12.3, 12.4, 12.5, 12.9, 13.1_

  - [ ]* 8.2 Write unit tests for controller flows
    - File `tests/ui/game-controller.test.ts` with fake view, fake clock and `MemoryKeyValueStore`: boot then start; skip during boot; game-over notice; New game confirm yes and no; Autosave written after `step` and deleted at `over`; SAVE then new game then RESUME; engine exception keeps state; output listeners called on reveal; observers run after the Original_Text is appended; `oldstyle` chosen from the selected Mode (1976 gives no `> ` prompt, haunted does).
    - _Requirements: 4.9, 5.7, 5.10, 9.5, 10.6, 10.7, 11.6, 11.7, 12.3, 12.5, 15.2_

  - [ ]* 8.3 Write property test for prompt echo and tracking
    - File `tests/ui/properties/p03-prompt-echo.test.ts`.
    - **Property 3: Prompt echo and prompt tracking**
    - **Validates: Requirements 5.4, 5.5**

  - [ ]* 8.4 Write property test for controller transparency
    - File `tests/ui/properties/p04-controller-transparent.test.ts`.
    - **Property 4: The controller is transparent to the engine**
    - **Validates: Requirements 1.4, 7.2, 7.4, 7.6, 7.7, 12.8**

  - [ ]* 8.5 Write property test for submission order
    - File `tests/ui/properties/p05-submission-order.test.ts`.
    - **Property 5: Submission order is preserved under pending output**
    - **Validates: Requirements 4.12, 6.8**

  - [ ]* 8.6 Write property test for the Mode to oldstyle mapping
    - File `tests/ui/properties/p13-mode-oldstyle.test.ts`.
    - **Property 13: Mode selects the engine's oldstyle option**
    - **Validates: Requirements 11.6, 11.7**

  - [ ]* 8.7 Write property test for Mode changes on a running game
    - File `tests/ui/properties/p14-mode-change-running.test.ts`.
    - **Property 14: Changing the selected Mode never alters the running game**
    - **Validates: Requirements 11.3, 11.8**

  - [x] 8.8 Write the win430 UI test
    - File `tests/ui/win430.test.ts`. Reuse the helpers in `tests/replay-harness.ts` (`readUpstream`, `splitLog`, `parseOptions`, `HARNESS_DEFAULT_SEED`) without editing them. Play every line of `reference/open-adventure/tests/win430.log` through `GameController` with `FakeClock.now() === 0`, speed `instant`, `MemoryKeyValueStore`, a `FakeTerminal` that captures chunks outside the 2000-line cap, and the same options as the upstream harness.
    - Register an event observer on `ExtensionHooks` that records `game-over` events (the log runs with `oldstyle` false, so Game_Mode is `haunted` and observers are called).
    - Assert that the `score` field of the last `game-over` event is exactly 430 and that `session.status` is `over`. Do not use `score` events and do not import `computeScore`.
    - Assert that the Original_Text captured by the fake view equals `render(replayLog('win430').events, { echo: false })`.
    - _Requirements: 1.4, 15.4_

- [x] 9. Checkpoint - controller and win430
  - Run `npx vitest --run` and `npm run typecheck`. Ensure all tests pass, ask the user if questions arise.

- [x] 10. DOM glue, CSS and pages
  - [x] 10.1 Create `src/ui/crt.css`
    - Tokens: `--fg #33ff66`, `--bg #020a04`, `--fg-dim`, `--focus #ffd54f`, `--font`, `--scanline-period 3px`, `--flicker-opacity 0.96`, `--flicker-duration 0.5s`, `--blink-duration 1s`. `@font-face` for VT323 with `font-display: swap` and URL `/fonts/VT323-Regular.woff2`. Font stack `"VT323", "Courier New", Courier, monospace`, used on html, input, button and select.
    - Scanline overlay, curvature and vignette, glow, flicker, solid block cursor with blink, `@media (prefers-reduced-motion: reduce)` disabling all animations with a steady cursor, `html[data-crt="off"]` plain look, reduced curvature and vignette under 600 px, `clamp()` body size of at least 14 px at 320 px wide, input font size of at least 16 px, `:focus-visible` outline, `.line` as `pre-wrap` with `overflow-wrap: anywhere`, `html, body { overflow-x: hidden }`, `.app` using `--vv-height` and `--vv-top`, `.sr-only`, empty-line `::before` zero-width space, and distinct classes `.line--original`, `.line--input`, `.line--notice`, `.line--narrator`, `.line--boot`.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 2.8, 2.9, 2.10, 2.12, 2.13, 2.14, 3.1, 3.3, 3.7, 3.8, 5.3, 12.4, 14.4_

  - [x] 10.2 Create `index.html`
    - `<html lang="en">`, title `ADVENT: Resurrected`, viewport meta with `width=device-width, initial-scale=1, viewport-fit=cover`, the `.app` shell (controls header, transcript `role="log"`, input line with cursor, sr-only `aria-live="polite"` region), CSS link and `<script type="module" src="/src/main.ts">`. Same-origin assets only; no "Colossal Cave" or "Zork" in visible text.
    - _Requirements: 1.3, 2.11, 14.5_

  - [x] 10.3 Implement `src/ui/dom/browser-ports.ts` and `src/ui/dom/viewport.ts`
    - `browser-ports.ts`: `localStorage` `KeyValueStore` (probe with try/catch; pass `undefined` to `ResilientStore` when blocked), `Clock` over `Date.now`, `MotionPreference` over `matchMedia` (not reduced when unsupported), `Logger` over `console.error`.
    - `viewport.ts`: `visualViewport` `resize`/`scroll` listeners (fallback to `window` `resize`) setting `--vv-height` and `--vv-top` in a `requestAnimationFrame`, keeping the Input_Line visible; pure `shouldStick({ scrollTop, clientHeight, scrollHeight }, tolerancePx = 4)` for scroll-follow.
    - _Requirements: 3.5, 5.12, 6.7, 9.7_

  - [x] 10.4 Implement `src/ui/dom/terminal-view.ts`
    - `TerminalPort` implementation: per-line `<div class="line line--KIND">` with a single `Text` node extended via `appendData`, `beginBlock`/`writeChunk`/`endBlock`, `appendInstant`, `clear`, `trimTo`, `setPrompt`, `setInputEnabled`, `setBusy` (toggles `aria-hidden` on the transcript while animating), `announce` into the aria-live region, `showMode`. Text only via `textContent`/`Text` nodes.
    - _Requirements: 5.3, 5.9, 5.11, 5.12, 6.10, 12.4_

  - [x] 10.5 Implement `src/ui/dom/input-line.ts`
    - Real `<input type="text" maxlength="1023" autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false" enterkeyhint="send">` with a transparent caret and a separate block cursor positioned from `selectionStart` in `ch` units (recomputed on `input`, `keyup`, `click`, `select`, `selectionchange`). Keydown: during boot call `skip()` and `preventDefault()`; while the Teletype is busy call `flush()` and continue; Enter submits and clears; Up/Down call history recall, `preventDefault()` and move the caret to the end. Tap on the Screen focuses the input when the text selection is empty.
    - _Requirements: 3.2, 3.4, 3.6, 4.9, 6.5, 6.8, 7.1, 7.3, 7.5, 7.8, 8.2, 8.3, 8.6_

  - [x] 10.6 Implement `src/ui/dom/controls.ts`
    - Native controls: `1976 MODE` / `HAUNTED MODE` radio-style group (`role="radiogroup"`, `aria-checked`), Typing_Speed `<select>` (20, 60, 120, 300, INSTANT), CRT toggle button with `aria-pressed` that sets `html[data-crt]`, `New game` button, and a `Credits` link (`target="_blank" rel="noopener"`). Every control has visible text or `aria-label`, is reachable by Tab, and works with Enter or Space.
    - _Requirements: 2.8, 6.2, 11.1, 14.1, 14.2, 16.6_

  - [x] 10.7 Implement `src/main.ts`
    - Read settings, apply CRT and Mode to the DOM before the boot, build the ports, `TerminalView`, `ExtensionHooks` (no handlers registered), `GameController`, input line, controls and viewport; call `startBoot()`; run the `requestAnimationFrame` loop calling `controller.tick(performance.now())`; focus the input when the boot ends. Show the `SAVES WILL NOT SURVIVE A RELOAD` notice via `onDegradedStorage`.
    - _Requirements: 1.1, 1.2, 4.1, 13.2, 14.3_

  - [x] 10.8 Implement the credits page
    - Create `credits.html` (same font and CSS) and `src/ui/dom/credits-page.ts`, which imports `CREDITS.md`, `original/ATTRIBUTION.md` and `original/COPYING` with Vite `?raw` and writes them with `textContent` into a `<pre>`. The page may use the historical game name in its credits text.
    - _Requirements: 16.6, 16.10_

  - [ ]* 10.9 Write DOM tests with happy-dom
    - Files under `tests/ui/dom/`, using the mechanism confirmed in task 1.1 (docblock or project glob). Check: input attributes; `<script>` and `<img onerror>` text from the engine appears as text, not elements; the aria-live region receives whole blocks and the transcript is `aria-hidden` while animating; controls are native, labelled, with no negative `tabindex`; keydown during boot calls `skip` and is `preventDefault`-ed; Up/Down recall moves the caret to the end; a tap on the Screen focuses the input.
    - _Requirements: 3.2, 3.4, 3.6, 4.9, 5.9, 6.10, 8.6, 14.1, 14.2_

  - [ ]* 10.10 Write CSS, asset and HTML tests
    - Files `tests/ui/css-assets.test.ts` and `tests/ui/html.test.ts`. Read `crt.css`: scanline period in [2px, 4px]; flicker opacity >= 0.95 and duration >= 0.34 s; blink period in [0.8 s, 1.2 s]; `@font-face` with `font-display: swap` whose file exists in `public/`; font-stack order; reduced-motion block disables each animation; input font size >= 16 px; body size >= 14 px at 320 px; WCAG contrast of `--fg` on `--bg` >= 4.5 including the 22% scanline and 96% flicker worst case; focus colour >= 3:1. Check `CREDITS.md` mentions `VT323` and `SIL Open Font License` or `OFL`, and `public/fonts/OFL.txt` exists. HTML: `lang="en"`, title, viewport meta, no absolute `http(s)` asset URLs, no "Colossal Cave" or "Zork" in visible UI.
    - _Requirements: 2.2, 2.4, 2.5, 2.6, 2.7, 2.11, 2.12, 2.13, 2.15, 2.16, 2.17, 2.18, 3.3, 3.7, 14.4, 14.5_

- [x] 11. Layering test and build check
  - [x] 11.1 Write `tests/ui-layering.test.ts`
    - New file; do not edit `tests/lint.test.ts`. Rules: `src/ui/**` and `src/main.ts` import the engine only through `src/engine/index`; nothing from `src/haunt`, `src/parser` or `src/voice`; files directly in `src/ui/` mention none of `document`, `window`, `localStorage`, `sessionStorage`, `navigator`, `matchMedia`, `visualViewport`, `requestAnimationFrame`, `setTimeout`, `setInterval`, `Date`, `Math.random`, `fetch`, `XMLHttpRequest` in code (use the same comment/string-ignoring lexer approach as the existing lint test); no `innerHTML`, `outerHTML` or `insertAdjacentHTML` under `src/ui`; the engine imports nothing from `src/ui`.
    - _Requirements: 1.2, 1.5, 1.6, 5.9, 15.1, 15.6_

  - [x] 11.2 Run the typecheck, the build and the dist check
    - Run `npm run typecheck`, `npm run build` and `npm run check:dist` (after task 12.3 exists). Fix any failure. This only builds locally; do not deploy.
    - _Requirements: 16.1, 16.2, 16.3, 16.9, 16.10_

- [x] 12. Cloudflare Pages preparation, credits and CI (no deployment)
  - [x] 12.1 Create `CREDITS.md`
    - Name VT323, its author Peter Hull and the SIL Open Font License 1.1; state that the font file is bundled in `public/fonts/`; record the OFL source URL from `.kiro/specs/crt-terminal-ui/font-source.md`; credit Open Adventure (BSD-2) and the original game by Crowther and Woods, pointing to `original/ATTRIBUTION.md`.
    - _Requirements: 2.15, 2.16, 16.6, 16.10_

  - [x] 12.2 Create `public/_headers` and `wrangler.toml`
    - `_headers`: same-origin `Content-Security-Policy` (`default-src 'self'; img-src 'self' data:; style-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
    - `wrangler.toml`: only `name`, `pages_build_output_dir = "./dist"` and `compatibility_date`. No account ID, token or secret. Do not add wrangler as a dependency and do not run it.
    - _Requirements: 1.2, 1.3, 16.5_

  - [x] 12.3 Create `scripts/check-dist.ts`
    - After a build, assert: `dist/index.html` and `dist/credits.html` exist; every local `src`/`href` in them resolves to a file in `dist`; `dist/fonts/VT323-Regular.woff2` and `dist/fonts/OFL.txt` exist; the credits bundle mentions "VT323" and "SIL Open Font License". Exit non-zero otherwise.
    - _Requirements: 16.2, 16.9, 16.10_

  - [x] 12.4 Create `.github/workflows/ci.yml`
    - Trigger `push`; job on `ubuntu-24.04`; steps `actions/checkout@v7.0.1`, `actions/setup-node@v7.1.0` with `node-version: 22` and `cache: npm`, `npm ci`, `npm run typecheck`, `npx vitest --run`, `npm run build`, `npm run check:dist`. No `secrets.*`, no wrangler, no deploy step.
    - Before pinning, confirm the two action tags exist (for example with the GitHub releases pages) and use the latest exact tags if they differ.
    - _Requirements: 16.11, 17.1, 17.2, 17.3, 17.4, 17.5, 17.6_

  - [x] 12.5 Update `README.md`
    - Add a "Deploy to Cloudflare Pages" section as instructions only: `npm ci` and `npm run build` then inspect `dist/`; `npx wrangler login` (done by the user); create the Pages project and publish with `npx wrangler pages deploy dist --project-name <name>`, or connect the Git repository with preset None, build command `npm run build`, output directory `dist`, Node 22 via `.node-version`; open the `*.pages.dev` URL and run the manual checklist; no environment variables or secrets are needed.
    - Add the test notes (which happy-dom mechanism the spike confirmed), the real-device checklist (on-screen keyboard on iOS Safari and Chrome Android, no horizontal scroll at 320 px and 1920 px, curvature keeping every character visible on small screens, visual feel of the effects) and the note that later specs widen `connect-src` and add a `Permissions-Policy`.
    - _Requirements: 16.5, 16.11_

  - [ ]* 12.6 Write config tests
    - File `tests/ui/ci-config.test.ts` (parses YAML with the already-installed `yaml`): workflow trigger `push`; steps include `npm ci`, `npm run typecheck`, `npx vitest --run`; fixed `node-version`; `uses:` pinned to exact tags; no `secrets.`; no `wrangler` or deploy command in the workflow. `wrangler.toml` holds only `name`, `pages_build_output_dir`, `compatibility_date`. `package.json` `build` is `npm run typecheck && vite build`; README mentions `npm run build`, `dist` and the Node version.
    - _Requirements: 16.1, 16.5, 16.11, 17.1, 17.2, 17.4, 17.5_

- [x] 13. Final checkpoint - full suite
  - Run `npx vitest --run`, `npm run typecheck`, `npm run build` and `npm run check:dist`. Ensure all tests pass, ask the user if questions arise. Remind the user that the first Cloudflare Pages deploy is manual (README steps) and was not performed.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. Required tests: Property 6, Property 1, Property 18, Property 8, the `win430` UI test and the layering test.
- Each task references specific requirements for traceability. Checkpoints ensure incremental validation.
- Property tests validate universal correctness properties; unit tests validate examples and edge cases. Each property lives in its own file under `tests/ui/properties/`, so these tasks can run in parallel.
- Task 1.2 stops and asks the user if the OFL source cannot be reached; the licence text must never be retyped.
- No task deploys. `wrangler login` and `wrangler pages deploy` appear only as README instructions for the user.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "2.2"] },
    { "id": 2, "tasks": ["2.3", "3.1", "3.4", "3.7", "4.1", "5.1", "5.4", "6.5", "10.1", "10.2", "12.1", "12.2", "12.3", "12.4", "12.5"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.5", "3.6", "3.8", "3.9", "3.10", "4.2", "4.3", "4.4", "5.2", "5.3", "5.5", "6.1", "6.6", "6.7", "10.3", "10.4", "10.8", "10.10", "12.6"] },
    { "id": 4, "tasks": ["6.2", "6.3", "6.4", "8.1"] },
    { "id": 5, "tasks": ["8.2", "8.3", "8.4", "8.5", "8.6", "8.7", "8.8", "10.5", "10.6"] },
    { "id": 6, "tasks": ["10.7", "10.9"] },
    { "id": 7, "tasks": ["11.1", "11.2"] }
  ]
}
```
