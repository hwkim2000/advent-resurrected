# Spike results: voice-input (task 1)

Consolidates tasks 1.1 to 1.4. All checks were offline (no wrangler, no network). Scratch tests and scratch vitest configs were deleted. Versions: Node v22.23.4, Vitest 5.1.0, happy-dom 21.0.4, TypeScript 7.0.2, fast-check 4.10.2.

Outcome: no design assumption was false. No change to `design.md` is needed. No requirement wording is affected, so no `user_input` was needed.

## Baseline

- `VOICE_INPUT_BASE_COMMIT` = `611ab3de150f27119d5243aac8c8a8650c215c62` ("Set real D1 database id for advent-gate"). Working tree clean apart from `.kiro/specs/voice-input/`.
- `npm run typecheck`: exit 0. `npx vitest --run`: 36 files passed, 497 tests passed, 8 skipped (4 in `tests/fidelity.test.ts`, 4 in `tests/ui/ai-isolation.test.ts`), no pre-existing failure.
- Frozen-path diff for the checkpoints (must be empty):
  `git diff --stat 611ab3de150f27119d5243aac8c8a8650c215c62 -- src/engine src/data src/parser src/parse-api functions migrations wrangler.toml original reference`

## Results table

| # | Item | Verified | Result | Fallback chosen | Affected tasks |
|---|---|---|---|---|---|
| 1 | `PointerEvent` fields (`pointerType`, `pointerId`, `isPrimary`, `button`) | yes | All kept | None; the `firePointer` helper is not needed. Use `new PointerEvent(...)` with `bubbles: true`, `cancelable: true` | 9.4 |
| 2 | `MouseEvent('click', { detail })` | yes | 0 and 1 kept | None | 9.4 |
| 3 | `preventDefault` / `defaultPrevented` on `contextmenu`, `mousedown`, `pointerdown` | yes | Works when `cancelable: true` | None | 9.4 |
| 4 | `setPointerCapture`, `releasePointerCapture` | yes | Exist | None | 9.3, 9.4 |
| 5 | `KeyboardEvent` fields (`code`, `altKey`, `ctrlKey`, `metaKey`, `shiftKey`, `repeat`) | yes | All kept | None | 9.4 |
| 6 | Dispatch of `visibilitychange` (document), `pagehide`, `blur` (window) | yes | Listeners fire. `document.hidden` stays `false` | Treat the event itself as the signal. A test may override `document.visibilityState` with `Object.defineProperty` (not verified) | 8.x, 9.3, 9.4 |
| 7 | `button.focus()`, `input.focus({ preventScroll: true })` | yes | `activeElement` updates; `value`, `selectionStart`, `selectionEnd` unchanged | None | 9.3, 9.4 |
| 8 | `hidden` property and attribute | yes | Set together | None | 9.4 |
| 9 | `getComputedStyle(el).display` with `hidden` and no stylesheet | **no** | happy-dom has no UA `[hidden]` rule; reports `block` / `inline-block` | Assert `el.hidden` and `hasAttribute('hidden')`. Assert computed `display: none` only in the optional CSS test (9.6) with the real stylesheet | 9.4, 9.5, 9.6 |
| 10 | `getComputedStyle` with author rule `[hidden] { display: none !important; }` | yes | Reports `none` | Add that rule to the CSS | 9.5, 9.6 |
| 11 | `DOMParser` on `hidden`, `hidden=""`, `hidden="hidden"` | yes | All three parse; `hasAttribute('hidden')` true | None; test with `hasAttribute('hidden')` | 12.3 |
| 12 | `FakeSpeechRecognition` shape (recorded writes, `InvalidStateError` on double `start()`, `emit*`, `supportPhrases`, `FakeSpeechRecognitionPhrase`) | yes | Works | None | 2.5, 8.7 |
| 13 | Install / remove fake on `globalThis` and `window` | yes | Works in node and happy-dom. In happy-dom `window === globalThis` | None; call `uninstall` in `afterEach` | 2.5, 8.7, 8.8 |
| 14 | TS DOM lib declares `SpeechRecognition` / `webkitSpeechRecognition` | **no** | Not declared (TS2552 / TS2304) | Adapter uses its own `SpeechRecognitionLike*` structural types, which compile under strict + `noUncheckedIndexedAccess` | 8.1, 8.7 |
| 15 | TS DOM lib declares `SpeechRecognitionEvent`, `...ErrorEvent`, `...Result`, `...ResultList`, `...Alternative` | yes | Declared | Still do not rely on them in the adapter | 8.1 |
| 16 | Capture stubs (`getUserMedia`, `MediaRecorder`, `createMediaStreamSource`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`) via `Object.defineProperty`, `configurable: true` | yes | Full suite with the scratch setup: 36 files, 497 passed, 8 skipped, 0 failed | None dropped; all seven kept | 2.3, 13.4 |
| 17 | `AudioContext` in node and happy-dom | yes | `undefined` in both, so the `createMediaStreamSource` stub is skipped; `AudioContext` itself is never replaced | None | 2.3 |
| 18 | Constructor stubs written as arrow functions | **no** | `new X()` fails with "is not a constructor" instead of the guard error | Use `function blocked(): never { throw ... }` for `MediaRecorder`, `XMLHttpRequest`, `WebSocket`, `EventSource` | 2.3 |
| 19 | `navigator.mediaDevices` exists | **no** (absent in node) | Absent in node; happy-dom lacked it in the scratch run | Setup creates `navigator.mediaDevices = {}` when missing, then defines `getUserMedia`. After that it exists in every test | 2.3, 8.8 |
| 20 | `isDistanceOne` vs OSA, alphabet `{a,b,c}`, lengths 0 to 5 (132,496 pairs) | yes | Equal for every pair. OSA equals unrestricted Damerau-Levenshtein whenever either distance is at most 1 | None; the `=== 1` DP fallback is not needed | 3.3, 3.16, 3.17 |
| 21 | fast-check 4.10.2 API forms | yes | See "fast-check forms" below | None | 2.5, 3.7 to 3.19 |
| 22 | `lookupWord('xyzzy')` | yes | `{ cls: 'motion', id: 62, canonical: 'XYZZY' }`, equals `XYZZY` (62) in `src/data/constants.ts` | None | 3.5, 3.9 |
| 23 | `xyzzyx`, `go xyzzy` | yes | `xyzzyx` resolves to XYZZY (first five characters). `go xyzzy` is a valid two-word line (GO = action 11) | None | 3.5, 3.9 |
| 24 | Magic words in vocabulary | yes | `plugh` = motion 65. `plover` = motion 70, canonical `PLOVE`. `fee` = action 25, `fum` = action 29 | None; the nine-exception list in 3.9 (`xyzzy plugh plove plover fee fie foe foo fum`) is correct | 3.9, 3.13 |
| 25 | `isMetaWord` | yes | True for `quit save resume seed waste` and also `suspend pause restart`. False for `abort stop xyzzy`. `META_WORDS` = quit, suspe, pause, save, resum, resta, seed, waste | None; add `suspend`, `pause`, `restart` to the 3.15 tests. The Voice_Layer uses `isMetaWord` and defines no list | 3.6, 3.15 |
| 26 | `isClassicCommandText(text, zzword, oldstyle)` | yes | Needs engine state, so it is not used by the Voice_Layer (DD-4) | None | 3.6 |
| 27 | `tests/ui/win430.test.ts` construction | yes | See "win430 facts" below | None | 13.2, 13.3 |
| 28 | `public/_headers`, README sentence, `PRIVACY_STATEMENTS`, `makeDist` | yes | See "Repo facts" below | None | 2.4, 12.x |
| 29 | Layering scan coverage | yes | `src/ui/dom/*` and `src/main.ts` are exempt from the pure-file browser-API scan. The HTML-sink scan covers all of `src/ui` | None; no scan change for `setTimeout` in `mic-button.ts` | 2.2, 9.3 |
| 30 | `src/main.ts` wiring | yes | See "Repo facts" below | None | 10.x |
| 31 | `tests/ui/support` exports | yes | See "Repo facts" below | None | 5.5 |

## fast-check forms (4.10.2)

- Import: `import fc from "fast-check";`
- Assert: `fc.assert(fc.property(arb1, arb2, (a, b) => bool_or_void), { numRuns: 100, seed: 20261031, verbose: 1 })`. A failure message contains `Property failed after N tests`, `{ seed: 20261031, ... }`, `Counterexample: [...]`. `verbose: 1` prints only on failure. Returning `false` fails the property.
- Strings:
  - `fc.string({ unit: "binary" })` gives any code point, astral included, but never lone surrogates.
  - Lone surrogates: `const loneUnit = fc.integer({ min: 0xd800, max: 0xdfff }).map((c) => String.fromCharCode(c));` then `fc.string({ unit: fc.oneof(loneUnit, fc.constantFrom("a", "é", "\u{1F600}")), maxLength: 20 })`.
  - `unit` values: `"grapheme"`, `"grapheme-ascii"`, `"binary"`, `"binary-ascii"`, or an arbitrary of single-character strings.
  - `minLength` / `maxLength` count code points for `"binary"`. For an exact `.length` of 10,000 use `"binary-ascii"`.
  - Long inputs are rare by default. Use `size: "max"` (`fc.string({ unit: "binary", maxLength: 10000, size: "max" })`) or fixed `minLength: 10000`.
- Also confirmed: `fc.constantFrom`, `fc.array(..., { maxLength })`, `fc.oneof`, `fc.option(arb, { nil: undefined })`, `fc.tuple`, `fc.anything()`, `fc.boolean()`, `fc.nat()`, `fc.integer({ min, max })`, `fc.sample(arb, { numRuns, seed })`.

## `isDistanceOne` reference (passed the exhaustive check)

```ts
export function isDistanceOne(a: string, b: string): boolean {
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a[i] === b[i]) i++;
  if (i === la && i === lb) return false;            // equal
  if (la === lb) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;           // substitution
    return i + 1 < la && a[i] === b[i + 1] && a[i + 1] === b[i]
      && a.slice(i + 2) === b.slice(i + 2);                       // adjacent transposition
  }
  return la > lb ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i); // insert/delete
}
```

## win430 facts

- Reads `win430.log` via `readUpstream`, options via `parseOptions`, lines via `splitLog` (from `tests/replay-harness.ts`).
- `clock = new FakeClock(HARNESS_DEFAULT_SEED)`; `HARNESS_DEFAULT_SEED = 0`. The seed is `clock.now() | 0`.
- `kv = new MemoryKeyValueStore()`; `kv.set(SETTINGS_KEY, printSettings({ mode: options.oldstyle ? '1976' : 'haunted', speed: 'instant', crt: true }))`.
- `new GameController({ kv, clock, motion: new FakeMotion(false), view: new FakeTerminal(), hooks: new ExtensionHooks(log), log: new RecordingLogger() })`.
- Flow: `startBoot()`, `tick(0)`, `skip()`, expect `phase === 'ready'`, then `for line of lines: if phase !== 'ready' break; controller.submit(line)`, then `tick(0)`.
- Score: `hooks.addEventObserver` collects `game-over` events; the last has `score` 430 (the last `score` event is 426; bonuses are added in `game-over`). `log.entries` must equal `[]`. Original text: `view.textOfKind('original')` equals `render(replayLog('win430').events, { echo: false })`.

## Repo facts

- `public/_headers` (whole file, no `Permissions-Policy` yet):
  ```
  /*
    Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'
    X-Content-Type-Options: nosniff
    Referrer-Policy: no-referrer
  ```
- `README.md` line 91 contains exactly: "Later specs (microphone) may add a `Permissions-Policy`."
- `scripts/check-dist.ts` `PRIVACY_STATEMENTS` (line 22): `a: ['cloudflare workers ai', 'third-party', 'short description', 'last two accepted commands']`, `b: ['1976 mode sends no player input']`. Checked against the visible, lower-cased, whitespace-collapsed text of the credits bundle.
- `makeDist(over: Overrides = {})` in `tests/scripts/check-dist.test.ts` (line 30), `Overrides { files?: Record<string, string | null> }` (null deletes a default). Default files: `index.html`, `credits.html`, `fonts/VT323-Regular.woff2`, `fonts/OFL.txt`, `_routes.json`. Uses `mkdtemp` in `os.tmpdir()`, removed in `afterEach`. The file uses no semicolons.
- `tests/ui-layering.test.ts`:
  - `UI_FILES` = non-test `.ts` under `src/ui` (recursive) plus `src/main.ts`. `PURE_UI_FILES` = files directly in `src/ui` only.
  - Existing import test "src/ui and src/main.ts import nothing from src/haunt, src/voice, src/shared or src/parse-api" uses `importSpecifiers` (includes dynamic imports). It currently forbids `main.ts` from importing `src/voice` and `src/haunt` even dynamically, so task 2.2 must split it before `main.ts` gains `import('./voice/browser')`.
  - Helpers for task 2.2: `importRefs` (static vs dynamic), `staticParserImports`, `resolveSpec`, `isInside`, `strip`.
  - `src/ui/voice-port.ts` sits directly in `src/ui`, so it must stay type-only with no browser names.
- `src/main.ts`: line 20 `import { createHauntedStartLoader } from './ai-loader';`; line 59 `const onGameStart = createHauntedStartLoader(() => controller, log, loadParserModule);`; lines 60 to 69 build `GameController` with `confirm: (message) => window.confirm(message)` and `onGameStart`; line 70 `controller = ctl`; lines 97 to 99 the `requestAnimationFrame(frame)` loop (refocuses `els.input` when focus is lost, line 95). `main.ts` already uses `window.confirm`; the "no confirm" rule applies to voice and DOM code only.
- `tests/ui/support/fakes.ts` exports: `FakeClock` (ctor `start = 0`), `FakeMotion` (ctor `isReduced = false`), `TerminalCall`, `CapturedBlock`, `FakeTerminal` (`calls`, `chunks`, `textOfKind`), `RecordingLogger` (`entries`).
- `tests/ui/support/generators.ts` exports: `arbText`, `arbTextOrEmpty`, `arbOutputEvent`, `arbOutputEvents`, `LINE_KINDS`, `arbLineKind`, `arbTranscriptLine`, `arbMode`, `arbSpeed`, `arbSettings`, `REAL_COMMANDS`, `arbRealCommand`, `arbAnyLine`, `arbCommandSequence`, `HookBehavior`, `HookSpec`, `arbHookList`, `TickStep`, `arbTickSchedule`.

## Notes for downstream tasks

1. 2.3 (`tests/setup/no-capture.ts`): constructor stubs (`MediaRecorder`, `XMLHttpRequest`, `WebSocket`, `EventSource`) must be plain `function` stubs that throw, not arrow functions. Create `navigator.mediaDevices = {}` when missing, then define `getUserMedia`. Skip `createMediaStreamSource` when `AudioContext` is undefined (it is in this repo). Never replace `AudioContext`.
2. 8.7 / 8.8: after the setup file runs, `navigator.mediaDevices` exists in every test. Detection tests that need "no mediaDevices" must pass an injected stub `win` / `navigator`, not read the global. Call `uninstall` for the fake recognition in `afterEach`; in happy-dom `window === globalThis`.
3. 8.1: the adapter uses its own `SpeechRecognitionLike*` types because TS 7.0.2 does not declare `SpeechRecognition` / `webkitSpeechRecognition`.
4. 9.4: use `new PointerEvent(...)` directly with `bubbles: true` and `cancelable: true`; no `firePointer` helper. Assert hiding via `el.hidden` / `hasAttribute('hidden')`, not computed `display`. For page-hidden, dispatch `visibilitychange` / `pagehide` / `blur`; the code must treat the event as the signal and must not rely on `document.hidden` (happy-dom keeps it `false`).
5. 9.5 (CSS): add `[hidden] { display: none !important; }` so an author `display` on `.mic-button` cannot override `hidden` in real browsers. 9.6 (optional) may assert computed `display: none` only with the real stylesheet loaded.
6. 12.3 (`check:dist`): test the `hidden` attribute with `hasAttribute('hidden')`; all three spellings parse.
7. 2.5 / 3.7: `voiceAssert` is `fc.assert(property, { numRuns: runs, seed: VOICE_SEED, verbose: 1 })` with `VOICE_SEED = 20261031`. Generators use the `loneUnit` form for lone surrogates and `size: "max"` or a fixed length for 10,000-character inputs (P1, P2); `"binary-ascii"` when an exact UTF-16 length is needed.
8. 3.3: use the `isDistanceOne` reference above; keep the OSA `damerauLevenshtein` as the model. The exhaustive `{a,b,c}` length 0 to 5 comparison can be reused as the example test for P6 (3.16).
9. 3.6 / 3.15: use `isMetaWord`; include `suspend`, `pause`, `restart` in the Meta tests next to `QUIT`, `SAVE`, `RESUME`, `SEED`, `WASTE`. Do not use `isClassicCommandText`.
10. 3.9 / 3.13: the nine vocabulary exceptions are `xyzzy plugh plove plover fee fie foe foo fum`; `plove` and `plover` both resolve to PLOVE.
11. 2.2: split the layering test as planned. No change to the pure-file scan is needed for `mic-button.ts`; it lives in `src/ui/dom`, which is exempt, and the injected `defer` keeps it testable anyway. The default `setTimeout` may live in `main.ts`.
12. 2.4: `makeDist` gains files and override keys only; keep the no-semicolon style.
13. Checkpoints (4, and later): use the frozen-path diff command in "Baseline".
