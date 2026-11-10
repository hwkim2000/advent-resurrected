# Design Document: ghost-voice

## Overview

Narrator lines are fixed text, so the voice is a static asset pipeline plus a small player:

```
build time (owner, once)                         play time (Haunted mode only)
scripts/gen-voice.ts                             haunting.ts output listener (kind 'narrator')
  voiceLines()  -> unique lines                     -> effects.speak({ key, text })
  Workers AI MeloTTS REST (env creds)            src/ui/dom/ghost-voice.ts   (inside the existing lazy chunk
  -> public/voice/<key>.mp3 + manifest.json          src/ui/dom/haunt-effects.ts, no new chunk, no main growth)
                                                    manifest fetch -> toggle -> queue -> Web Audio ghost chain
```

Facts from the code that shape this (read, not run):

- `HauntingHooks`/effects are structural types in `src/haunt/haunting.ts`; `src/ui/dom/haunt-effects.ts` is already a lazy chunk loaded only on a Haunted game start by `src/haunting-loader.ts`, so adding Ghost_Voice there keeps it out of the 1976 start script.
- `notifyOutput` fires per revealed block with `{text, kind}`; narrator lines are emitted one per block, so each block is one Voice_Line (trailing newline trimmed).
- Narrator-voice text lives in `src/haunt/lines.ts` (`ALL_POOLS`, `REINCARNATION_COUNTDOWN`), `src/haunt/yes-no.ts` (`NUDGE_LINES`) and `src/haunt/spoken-word-rule.ts` (`DEFLECTION_LINE`). One new module lists them all, so the generator and a sync test share the source.
- `public/_headers` CSP has `default-src 'self'` and `connect-src 'self'`, so same-origin `fetch('/voice/...')` needs no CSP change. `main.ts` owns the `ResilientStore` kv; the toggle preference uses it through a parameter (no `settings.ts` change, so `parseSettings` and the autosave format stay as is).
- `src/ui` may not import `src/haunt`/`src/shared`; `src/haunt` may not import `src/ui`. The Voice_Key function therefore lives in `src/haunt` and the key arrives with each `speak` call.
- There is no `ffmpeg` on this machine and no Cloudflare credentials in the environment; the generator writes whatever the model returns (MP3) and does not re-encode.
- MeloTTS REST output format (JSON with base64 audio, or raw MP3) is only documented loosely; the decoder accepts both and a test covers both. Not verified against the live API.

## Components

### src/haunt/voice-lines.ts (pure)
`voiceLines(): readonly string[]` (unique, sorted, normalized), `normalizeVoiceLine(text)` (trim, collapse whitespace), `voiceKey(text)` (FNV-1a 32-bit over the normalized text, 8 hex chars; collision check inside `voiceLines` tests). Includes a `VOICE_LINES_MARKER` constant only if needed by dist checks (the dist marker is `GHOST_VOICE_CHUNK_MARKER`, defined in `ghost-voice.ts`).

### scripts/gen-voice.ts (+ `npm run gen:voice`)
Pure helpers exported for tests: `planGeneration(lines, manifest, existingFiles, force)` -> `{generate, keep, remove}`, `decodeTtsResponse(contentType, bytes)` (JSON `{result:{audio}}` or `{audio}` base64, or raw MP3 by magic bytes `ID3`/`0xFFEx`), `buildRequest`. Main: read env, sequential requests with 3 retries and a short pause, write `public/voice/<key>.mp3`, rewrite `manifest.json` (`{version:1, model, generatedAt?, entries:{key:{file,bytes,text}}}`; no timestamp, so reruns are byte-stable), remove orphans. `--dry-run` never touches the network. The model id is one constant (`@cf/myshell-ai/melotts`); the credentials are never logged.

### src/ui/dom/ghost-voice.ts
`createGhostVoice({ doc, kv, motion, fetchFn, makeContext, log, now })`:
- `start()` (Haunted game start): fetches `/voice/manifest.json` once (cached; failure -> inactive, no toggle). Shows or creates the Voice_Toggle after the CRT control in `#controls`.
- `speak({key, text})`: ignored when inactive, off, locked (no user interaction yet), hidden tab, or no manifest entry. Otherwise goes through the queue.
- `stop()`: stops current (30 ms gain ramp), clears the waiting line.
- `dispose()` (1976 start): stop, hide/remove toggle, remove listeners.
- Unlock: one-shot capture listeners for `keydown`, `pointerdown`, `touchend` create/resume the context.
- Stop triggers: `input` and `keydown` on `#input`; `pointerdown`, `keydown` and `aria-pressed` change (MutationObserver) on `#mic`; `visibilitychange` hidden; plus `stop()` called by the haunting input transformer (command submit) and on game start/dispose.
- Fetch + `decodeAudioData` per key with a small LRU of decoded buffers (max 16); failure is cached as "no audio" for that key.

Queue policy (pure, `src/haunt/speech-queue.ts`, injected player): states `idle | playing`. `offer(item, now)`: idle -> play; playing -> replace the single waiting item. On end: take the waiting item if `now - offeredAt <= 8000`, else drop. `cancel()` clears everything. Tested with a fake player and clock.

Ghost chain (`buildGhostChain(ctx)`): `AudioBufferSourceNode` (playbackRate 0.92) -> high-pass 80 Hz -> split: dry gain 0.8; echo = DelayNode 0.19 s with feedback gain 0.3 into a low-pass 2.5 kHz, wet 0.35; reverb = ConvolverNode with a generated decaying-noise impulse (1.8 s, stereo, built once) wet 0.3 -> DynamicsCompressor -> master gain 0.7 -> destination. Pitch down is by playback rate only (slower and lower together), so no pitch-shifter node is needed. Reduced motion does not change the chain (sound is not motion); it only turns off the toggle's speaking animation via CSS.

Toggle: `<button type="button" id="voice-toggle" aria-pressed>` labelled `VOICE: ON`/`VOICE: OFF`, styled with the existing `.controls button` rules, `data-speaking="true"` while playing (CSS pulse, none under `prefers-reduced-motion`). Preference key `advent.ghost-voice` (`'1'`/`'0'`) in the kv; default on.

### Wiring
- `src/haunt/haunting.ts`: the structural effects type gains optional `speak?(item)`, `stopSpeaking?()`; the output listener for `kind === 'narrator'` calls `effects.speak?.({ key: voiceKey(text), text: normalized })`; the existing yes/no transformer path and `gameStart`/`dispose` call `stopSpeaking`. All guarded like the other callbacks.
- `src/ui/dom/haunt-effects.ts`: `createHauntEffects` takes an optional `kv`, creates Ghost_Voice, delegates `speak`/`stopSpeaking`, and starts it from a new `start()` that the loader calls on Haunted game start; `reset()` (1976) disposes it. `src/main.ts` passes `kv` (one argument).
- CSS: speaking indicator and reduced-motion override in `src/ui/crt.css`.
- Credits: `credits.html`/`CREDITS.md` get the AI-voice paragraph; `scripts/check-dist.ts` keeps its privacy checks and gains the marker check.

## Testing strategy
Fakes only, no network or audio device: fake `fetch`, fake `AudioContext` that records graph connections and `start` calls, fake clock. Example tests listed in Requirement 5.2. The manifest sync test is skipped (with a visible note) when `public/voice/manifest.json` does not exist, and strict when it does. A grep-style test asserts no TTS model id appears under `src/`, `functions/` or in `dist/` (only in `scripts/`).
