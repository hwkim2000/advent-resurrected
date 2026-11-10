# Implementation Plan: ghost-voice

## Overview

Order: shared line list and key, generator script, queue and ghost chain, Ghost_Voice module and toggle, wiring, credits and dist checks, final checkpoint. Tests run with `npx vitest --run`. No optional tasks. Rules for every task:

- No commit, no deploy, no `wrangler` command. Do not modify `src/engine`, `src/data`, `original/`, `reference/`, `src/parse-api`, `functions/`, `migrations/`, `wrangler.toml`.
- Credentials: never read them from files, never print them, never write them to the repo. Tests make no network calls (the test setup blocks `fetch`) and need no audio device.
- Layering (enforced by `tests/ui-layering.test.ts`, `tests/voice/layering.test.ts`, `tests/lint.test.ts`): `src/ui` imports nothing from `src/haunt`, `src/shared`, `src/voice`, `src/parser`; `src/haunt` imports nothing from `src/ui`; `src/main.ts` reaches haunt/ui-effects code only through dynamic `import()`. Files directly in `src/ui/*.ts` use no browser globals; DOM and timers go in `src/ui/dom/`.
- 1976 mode stays untouched. Record the main start-script size (raw and gzip, from `npm run build`) BEFORE any change in task 1.1 and compare in task 7.

## Tasks

- [x] 1. Voice lines, keys and baseline
  - [x] 1.1 Run `npm run build` and record the sizes of `dist/assets/main-*.js` (raw and gzip) in a scratch note for task 7 (do not commit the note; mention it in your reply).
  - [x] 1.2 Create `src/haunt/voice-lines.ts` (`normalizeVoiceLine`, `voiceKey`, `voiceLines`) collecting all pools from `src/haunt/lines.ts` (`ALL_POOLS`, `REINCARNATION_COUNTDOWN`), `NUDGE_LINES` in `src/haunt/yes-no.ts` and `DEFLECTION_LINE`. Verify those exports exist and that every narrator-voice text the controller can emit is covered (grep `emit('narrator'`, narrator provider returns, deflect lines).
  - [x] 1.3 Example tests: key stability and normalization (whitespace, trailing newline), no key collisions across all lines, `voiceLines()` unique and deterministic, covers every pool entry.

- [x] 2. Generation script
  - [x] 2.1 Create `scripts/gen-voice.ts` and the `gen:voice` npm script per the design (env credentials, incremental plan, retries, response decoding for JSON base64 and raw MP3, orphan removal, `--dry-run`, `--force`, byte-stable manifest). Export the pure helpers for tests.
  - [x] 2.2 Example tests under `tests/scripts/` for `planGeneration`, `decodeTtsResponse` (both shapes, garbage rejected), request building (correct URL/model/lang, no credential in logs), missing credentials error message, and manifest stability.
  - [x] 2.3 Run `npm run gen:voice -- --dry-run` and report the line count and character total. If `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` are both set in the environment, run the real generation once, then report the number of files and the total size in bytes (must be under 3 MB) and verify the files look like MP3 (magic bytes). If they are not set, do NOT ask and do NOT improvise another source: skip the real run and say so clearly.

- [x] 3. Queue and ghost chain
  - [x] 3.1 `src/haunt/speech-queue.ts`: pure queue policy per the design (one playing, one waiting, newer replaces waiting, 8 s staleness, cancel) with an injected player and clock.
  - [x] 3.2 `buildGhostChain(ctx)` in `src/ui/dom/ghost-voice.ts` (or a sibling file in `src/ui/dom/`) per the design parameters.
  - [x] 3.3 Example tests: queue behavior (idle, playing, replace, stale drop, cancel, end-of-play promotion) and chain parameters/connections via a fake context.

- [x] 4. Ghost_Voice module and toggle
  - [x] 4.1 `src/ui/dom/ghost-voice.ts`: `createGhostVoice` per the design (manifest fetch, lock until first interaction, decode cache, stop triggers, toggle button next to the CRT control, persisted preference via the kv, hidden-tab stop, `GHOST_VOICE_CHUNK_MARKER` constant, everything try/catch guarded). Add the speaking-indicator CSS with the reduced-motion override to `src/ui/crt.css`.
  - [x] 4.2 Example tests with happy-dom and fakes: inactive and no toggle without a manifest; toggle appears after the CRT control, default on, persists to the kv, off stops playback; lines before the first interaction are dropped; typing in `#input`, pointerdown or `aria-pressed` on `#mic`, hidden tab, dispose each stop and clear the waiting line; missing file, fetch error or decode error skip silently; only one source plays at a time; dispose removes the toggle and listeners.

- [x] 5. Wiring
  - [x] 5\.1 Extend the structural effects type and the narrator output listener in `src/haunt/haunting.ts` (speak with key and text; `stopSpeaking` on submit transformer, game start and dispose). Extend `createHauntEffects` in `src/ui/dom/haunt-effects.ts` to own Ghost_Voice (optional `kv`, `start()`, `speak`, `stopSpeaking`, `reset()` disposes) and have `src/haunting-loader.ts` call `start()` on Haunted game start. Pass `kv` from `src/main.ts` (single argument change).
  - [x] 5\.2 Example tests: a narrator block reveals -> one `speak` with the right key; non-narrator blocks never speak; 1976 start never imports the effects chunk or fetches `/voice/*` (extend `tests/ui/haunting-isolation.test.ts` style); switching to 1976 mid-session stops and removes the toggle; throwing voice code leaves the game playable.
  - [x] 5\.3 Add a test that no text-to-speech model id (e.g. `melotts`, `aura`) appears in `src/`, `functions/` (scripts/ and spec docs excluded).

- [x] 6. Credits and dist checks
  - [x] 6\.1 Add the AI-generated voice paragraph (MeloTTS, MIT, via Cloudflare Workers AI; pre-rendered; no player input sent) to `credits.html` and `CREDITS.md`, keeping the existing privacy statements that `scripts/check-dist.ts` requires; update any credits test accordingly. Mention `npm run gen:voice` and the 2026-11-20 deprecation date in the README (short).
  - [x] 6\.2 Extend `scripts/check-dist.ts` and its fixture test with the `GHOST_VOICE_CHUNK_MARKER` check (absent from the start script, present in a lazy chunk) and make sure the manifest/audio under `dist/voice/` (when present) is not scanned as text for credentials.
  - [x] 6\.3 Add the manifest sync test (strict when `public/voice/manifest.json` exists, visibly skipped otherwise) and the total-size check (< 3 MB) when audio exists.

- [x] 7. Final checkpoint: `npm run typecheck`, `npx vitest --run`, `npm run build`, `npm run check:dist`, `npm run check:layout`. Compare the main start-script raw/gzip size with the task 1.1 baseline and report the delta (expected: a few bytes). Report whether real audio was generated. List `git status --short` and confirm nothing in the protected directories changed. Do not commit or deploy.
