# Requirements Document

## Introduction

Spec 6 gives the narrator a voice. In Haunted mode only, every narrator line is also spoken aloud in a ghostly voice. The narrator lines are fixed text pools, so the audio is pre-generated once at build time by a script that calls Cloudflare Workers AI text-to-speech, saved as small files under `public/voice/`, and played in the browser through a Web Audio ghost effect (slight pitch down, echo, reverb). There are no runtime text-to-speech calls and no new network service at play time. This builds on spec 5 (narrator lines, `src/haunt`, `src/ui/dom/haunt-effects.ts`).

Decisions made while writing this spec (sources checked on 2026-11-10):

- **Model: `@cf/myshell-ai/melotts`.** MeloTTS is published under the MIT license, which the project README states is free for commercial and non-commercial use, and the model page imposes no restriction on the generated audio. The alternative `@cf/deepgram/aura-1` is covered by Deepgram's Terms of Service: the user keeps rights in the Output, but the terms add conditions (a duty to disclose that audio is artificially generated, an obligation to use Output "in accordance with these Terms", and Deepgram may change the terms), and they do not clearly address redistributing the files inside a public game. MeloTTS is therefore the safer choice for shipping the generated files.
- **Risk to note:** Cloudflare lists MeloTTS with a planned deprecation date of 2026-11-20. The audio only has to be generated once and the files are committed, so shipping is not affected, but the generation must be run before that date; later regeneration would need another model. The credits disclose that the voice is AI-generated either way.
- Not verified: the license of the MeloTTS model weights and training data beyond the repository's MIT statement, and Cloudflare's own terms for output of hosted models. Neither was read in full.

## Glossary

- **Voice_Line**: a fixed narrator text (any line the narrator, yes/no nudge or XYZZY hint can print).
- **Voice_Key**: a stable short hash of a normalized Voice_Line; names its audio file.
- **Voice_Manifest**: `public/voice/manifest.json`, mapping Voice_Key to file, size and text.
- **Ghost_Voice**: the player-side module that fetches, decodes, processes and plays Voice_Lines.
- **Voice_Toggle**: the VOICE on/off button next to the CRT toggle.

## Requirements

### Requirement 1: Pre-generated audio

1. A script `npm run gen:voice` SHALL collect every Voice_Line from the source pools, call Workers AI MeloTTS (REST, English) for each line that has no up-to-date file, write mono audio files under `public/voice/`, and write the Voice_Manifest. It SHALL be incremental (unchanged lines are skipped), delete files for lines that no longer exist, and support `--dry-run` (no network; prints line count and characters) and `--force`.
2. Credentials SHALL come only from the environment (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`); the script SHALL never read, print or store them in the repo, and SHALL fail with a clear message when they are missing.
3. A test SHALL fail when the manifest exists but does not cover every Voice_Line (stale audio), and no file under `src`, `functions` or `dist` SHALL call a text-to-speech model at runtime.
4. Total audio under `public/voice/` SHALL stay small (target under 3 MB).
5. The credits page and `CREDITS.md` SHALL state that the narrator voice is AI-generated (MeloTTS, MIT, via Cloudflare Workers AI) and that no player input is sent anywhere for it.

### Requirement 2: Speaking

1. In Haunted mode, when a narrator block finishes revealing and a Voice_Line audio exists, Ghost_Voice SHALL play it through a Web Audio chain: playback rate about 0.92 (slight pitch down), a short feedback echo, and a synthesized reverb, with a master gain and compressor so levels stay modest.
2. Lines without audio (missing manifest or file, fetch or decode failure) SHALL be skipped silently; the game and text are unaffected.
3. The audio context SHALL be created or resumed only after the first user interaction (key, pointer or touch); narrator lines before that are not spoken or queued.
4. 1976 mode SHALL load no Ghost_Voice code, make no request for `/voice/*`, and show no Voice_Toggle. The 1976 start script SHALL NOT gain the Ghost_Voice code or any audio reference; the extra lines in `main.ts` wiring are limited to passing the key-value store, and the start-script size change SHALL be measured and reported.

### Requirement 3: Never talk over itself

1. Only one Voice_Line plays at a time. While one plays, at most one later line waits (a newer line replaces an older waiting one); a waiting line older than 8 seconds is dropped.
2. Playback SHALL stop immediately (short fade) and the waiting line SHALL be dropped when the player types in the input, submits a command, presses or holds the MIC button (including Alt+M), starts a new game, switches to 1976, turns VOICE off, or the tab becomes hidden.

### Requirement 4: VOICE toggle

1. A VOICE ON/OFF toggle button (`aria-pressed`, keyboard operable) SHALL appear next to the CRT toggle in Haunted mode only when the Voice_Manifest loaded; otherwise it is not shown.
2. It SHALL be on by default in Haunted mode, remember the choice in the existing key-value store (so it survives reloads and degrades with the existing storage fallback), and turning it off stops any playing line.
3. While a line plays, the toggle SHALL show a speaking indicator; the indicator animation SHALL be disabled under `prefers-reduced-motion`. The audio effect itself is not motion and is not changed by that setting.

### Requirement 5: Resilience and testing

1. If anything in Ghost_Voice throws or Web Audio is unavailable, the game continues with text only; the feature never blocks input or output.
2. Tests SHALL cover: Voice_Key stability and normalization, manifest/pool sync (when a manifest is present), the speech queue policy, stop triggers, the toggle and persistence, 1976 isolation (no module load, no fetch), the ghost effect chain parameters (via a fake audio context), and the generation script's pure parts (collection, incremental plan, response decoding) without any network.
3. Existing suites (fidelity, walkthrough, layering, lint, check:dist) SHALL keep passing; `check:dist` SHALL verify the Ghost_Voice marker is absent from the start script and present in a lazy chunk.

## Open Questions and Decisions

- Generating the audio needs the owner's Cloudflare credentials. If they are not available when the tasks run, everything else is built and tested with fakes, the voice stays inactive (no manifest), and the owner runs `npm run gen:voice` once before 2026-11-20.
