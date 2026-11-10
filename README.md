# ADVENT: Resurrected

> You are in a maze of twisty little passages, all haunted.

The first adventure game ever made (1976) is back from the dead:
a haunted, voice-controlled resurrection of *Colossal Cave Adventure*
that runs in the browser with a retro green CRT terminal.

- Speak commands into the mic instead of typing
- An AI parser understands normal sentences, not just two-word commands like `get lamp`
- Halloween version of the original cave, with the original's famous moments kept intact

Built with [Kiro](https://kiro.dev) for Kiroween 2026.

## Develop

Requires Node 22 (see `.node-version`).

```
npm ci
npm run dev        # local dev server
npm run build      # typecheck + vite build -> dist/
npm run check:dist # verify dist/ contents (pages, VT323 font + OFL.txt, credits)
npm run test       # vitest --run (single run)
```

### Narrator voice audio

The narrator's spoken lines are pre-generated MP3 files under `public/voice/` (plus `manifest.json`), made once by `npm run gen:voice` with Cloudflare Workers AI MeloTTS. Until that is run, the voice is simply inactive (no VOICE button).

- Environment variables (names only, set in your own shell): CLOUDFLARE\_ACCOUNT\_ID and CLOUDFLARE\_API\_TOKEN (backslashes are markdown escapes; the repository credential scan forbids the literal names outside its own files).
- **ffmpeg** (with libmp3lame) must be on PATH: MeloTTS returns 44.1 kHz WAV, and the script transcodes each line to a mono 22.05 kHz, 48 kbps MP3. The script stops with a clear message if ffmpeg is missing (the dry run does not need it).
- `npm run gen:voice -- --dry-run` makes no network call; `--force` regenerates everything. Re-runs only generate changed lines. The total audio size limit is 4 MB (the script warns above it).
- Cloudflare lists MeloTTS with a planned deprecation date of **2026-11-20**: run the generation before then and commit the files. Regenerating later would need another model.

## Deploy to Cloudflare Pages

These steps are instructions for the **manual first deploy**, done by the project owner. The repository's tasks and CI never deploy, and nothing in the repo holds keys, tokens or account identifiers. `wrangler.toml` contains only non-secret settings (Pages settings, the AI and D1 bindings with a placeholder database id, and the tunable variables).

1. Build locally and inspect the output:
   ```
   npm ci
   npm run build
   ```
   Check that `dist/` contains `index.html`, `credits.html`, `fonts/VT323-Regular.woff2` and `fonts/OFL.txt`.
2. Log in to Cloudflare (opens a browser; you do this yourself):
   ```
   npx wrangler login
   ```
3. Create the Pages project and publish, either with the CLI:
   ```
   npx wrangler pages deploy dist --project-name <name>
   ```
   or by connecting this Git repository in the Cloudflare dashboard with these settings:
   - Framework preset: None
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Node version: 22 (taken from `.node-version`)
4. Open the resulting `*.pages.dev` URL and run the checklist below.
5. Set up the AI parser (owner steps; the repository never runs them):
   1. In the Cloudflare dashboard, enable the Workers AI binding `AI` for the Pages project (the binding is declared in `wrangler.toml`).
   2. Check `MODEL_NAME` and `DAILY_CAP` in `wrangler.toml` (or set them as Pages variables).
   3. Create the D1 database: `npx wrangler d1 create advent-gate`. Put the printed database id in `wrangler.toml`, replacing the all-zero placeholder.
   4. Apply the migration to the remote database: `npx wrangler d1 migrations apply advent-gate --remote` (it applies `migrations/0001_gate.sql`).
   5. Deploy again (step 3) so the Function and bindings go live.
   6. Verify on real D1 that the gate statements behave as in the local `node:sqlite` tests (numbered parameters and change counts), then run `measure:latency` (below).

### Local testing of the AI parser

```
cp .dev.vars.example .dev.vars   # local variables, git-ignored
npm run db:local                 # creates the local gate tables under .wrangler/state
npm run dev:pages                # build + wrangler pages dev dist
```

Warning: the local `AI` binding calls the real Workers AI service and uses the owner's free daily allocation. The automated tests never call it.

### Latency and cost

`npm run measure:latency -- https://<project>.pages.dev` sends a few sample sentences to a deployed `/api/parse` and prints p50 and p95. Read p95 first:

- `UPSTREAM_TIMEOUT_MS` (server, `wrangler.toml`) is about 1.5 x p95, rounded up to the next 100 ms.
- `AI_BUDGET_MS` (client, `src/parser/config.ts`) is at least 500 ms above `UPSTREAM_TIMEOUT_MS`, so the server answers or times out before the client gives up.

Measured on the deployed site (owner fills in after the first deploy): p50 = `TBD` ms, p95 = `TBD` ms.

Cost arithmetic: each request uses about 3.1 Neurons. With `DAILY_CAP` = 2000 that is 2000 x 3.1 = 6,200 of the 10,000 free Neurons per day, 62 percent, under the 80 percent limit. The cap must stay at 2,580 or lower (2,580 x 3.1 = 7,998).

Optional flood guard: add a dashboard rate-limiting rule for `/api/parse` on the Cloudflare zone, in addition to the per-address limit in the Function.

### Parser evaluation

`npm run eval:parser -- <base-url>` sends 34 fixed sentences (20 commands, 8 ask-the-ghost lines, 6 negatives) to `<base-url>/api/parse`, 2.5 s apart, and prints a PASS/FAIL table and totals. It exits non-zero if any case fails. Run it against `npm run dev:pages` (`http://127.0.0.1:8788`) or the deployed URL, and re-run it after deploying the prompt change. It uses real Workers AI quota (about 34 requests) and is never run by tests or CI. Model output varies, so an occasional miss is a signal to read, not necessarily a bug.

### Privacy

- In Haunted mode, a line that is not a classic command is sent to Cloudflare Workers AI, a third-party service, with a short description of the game (room name, visible objects, and the last two accepted commands).
- 1976 mode sends no player input to any service.
- Classic commands are never sent to the AI.
- Nothing else about the player or the game is sent.

The same text is on the credits page.

`public/_headers` sets a same-origin Content-Security-Policy (`connect-src 'self'`); the AI call goes to this site's own `/api/parse`, so it needs no wider policy. The same file sets `Permissions-Policy: microphone=(self)`, so only this site may use the microphone. See "Voice input" below for what `_headers` does and does not cover.

### Manual checklist (real devices)

- On-screen keyboard works on iOS Safari and Chrome on Android (input stays visible, no zoom on focus).
- No horizontal scroll at 320 px and at 1920 px widths.
- The CRT curvature keeps every character visible on small screens.
- The visual feel of the effects is right: scanlines, glow, flicker, blinking block cursor, and the CRT toggle and reduced-motion settings.
- Typing, command history (Up/Down), the boot skip, 1976/Haunted mode switch, and the Credits link all work.

Voice input checks (every item is **not verified** until a person runs it on the named device and records the result in "Findings" below):

- (a) **not verified.** Chrome desktop, Edge desktop, Safari on macOS, Safari on iOS and Chrome on Android each show the voice disclosure next to the mic button, start listening on the first press (mouse) or first tap (touch) with the browser permission prompt appearing at that moment, record a short phrase and submit it. Expected: the phrase appears as an input line and the game answers it.
- (b) **not verified.** The voice disclosure wraps without horizontal scrolling on a 320 CSS pixel wide viewport. Expected: no horizontal scrollbar, all text readable.
- (c) **not verified.** Deny the permission prompt once. Expected: the mic button and the voice disclosure hide for the rest of the page session, with no alarming message; typing still works.
- (d) **not verified.** A browser without the speech recognition API shows no mic button and no voice disclosure. A browser with the API (a Firefox build that ships it, if one is available) shows both, and hides both for the rest of the page session when `start()` fails with `not-allowed`, `service-not-allowed` or `language-not-supported`, or throws. Expected: exactly that.
- (e) **not verified.** 1976 mode. Expected: no mic button, no voice disclosure and no permission prompt.
- (f) **not verified.** Chrome, Edge and Safari recognize speech under the deployed Content-Security-Policy and Permissions-Policy. Expected: a spoken phrase is recognized; the first press does not end in a `denied` or `network` error after the prompt was accepted. If it does, record it under "Findings".
- (g) **not verified.** On touch (Safari on iOS, Chrome on Android): a tap starts recognition on the `click` and a second tap stops it; one tap never starts and stops twice; a long press starts nothing and shows no context menu; a double tap on the button does not zoom the page; the on-screen keyboard stays up. A mouse press-and-hold still works on desktop. Expected: all of these.
- (h) **not verified.** Type XYZZY. Expected: it is deflected once with the narrator hint; after a page reload the autosaved game is kept; the next typed XYZZY then works.
- (i) **not verified.** Brave or another Chromium derivative that returns `network`. Expected: the mic button hides after `REPEATED_ERRORS_BEFORE_HIDE` (3) consecutive errors.
- (j) **not verified.** Note which company processes the audio in each tested browser. Expected: a note per browser; the disclosure text is not changed.
- (k) **not verified.** Answer the browser permission prompt very slowly (longer than `MAX_LISTEN_MS` plus `RESULT_WAIT_MS`, so the start-confirmation timer fires). Expected: the calm message `VOICE TROUBLE. TYPE INSTEAD.`, no stuck mic button and no stuck `aria-pressed="true"`.

### Findings

Record each finding of a failed or surprising check here: date, check letter, browser and version, device, symptom. If the Content-Security-Policy or Permissions-Policy blocks recognition, the headers are changed together with their tests in a follow-up to the voice-input spec; they ship unchanged until then.

| Date | Check | Browser and version | Device | Result and symptom |
| ---- | ----- | ------------------- | ------ | ------------------ |
| (none yet) | | | | |

## Voice input

In Haunted mode a microphone button sits in the input line. Typing always works, whether or not the microphone, the speech API or the AI is available.

### How to use it

- Mouse or pen: press and hold the mic button to talk (push-to-talk) and release to send. A quick tap (shorter than 250 ms) latches listening on; tap again to stop.
- Keyboard: Alt+M works the same way as the button. Hold it for push-to-talk, tap it to latch, tap again to stop. With the button focused, Enter or Space toggles listening.
- Touch screens: tap-to-toggle. One tap starts listening, a second tap stops it. A long press does nothing.
- Listening ends by itself after `MAX_LISTEN_MS` (10 seconds) without a result.
- 1976 mode never uses the microphone: it shows no mic button and no disclosure.

### Supported browsers

Tested in Chrome, Edge and Safari (see the manual checklist for what has and has not been verified on real devices). The mic button is shown in any browser that exposes the speech recognition API and is hidden in a browser without it. After a denied or unusable start (for example a refused permission prompt) it is hidden for the rest of the page session, and typing carries on.

### The XYZZY rule

In Haunted mode XYZZY has to be spoken aloud. The first time you type XYZZY in a game, the narrator deflects it once with a hint (`DEFLECTION_LIMIT` = 1, once per game) and the game does not take a turn. The next typed XYZZY works normally. Typed XYZZY also always works whenever voice is unusable (unsupported, denied, hidden) and in 1976 mode. The game is completable without a microphone: all 430 points can be reached by typing alone. Spoken PLUGH, PLOVER and FEE FIE FOE FOO, and every other word, are never deflected.

### Voice privacy

The disclosure shown next to the mic button reads, verbatim:

> Speech is processed by your browser's speech service (from the maker of your browser). This game stores no audio.

In plain terms: voice input uses the speech recognition service built into your browser, run by the maker of the browser. Audio is sent to that service for recognition, and which company that is depends on the browser. This site never records or stores audio and never reads the microphone itself, only the text the browser returns. 1976 mode never uses the microphone, and typing always works.

The first press of the mic button starts listening straight away. The browser's own permission prompt is the only consent step; the site shows no extra dialog and keeps no record of consent (no cookie, no storage entry). If a spoken sentence is not a classic command, the text (not audio) goes to the AI parser under the privacy statement above, like a typed sentence.

### Headers

- `public/_headers` sets `Permissions-Policy: microphone=(self)`, so only this site may use the microphone.
- `_headers` applies to static assets only. It does not apply to the responses of the Functions under `/api`.
- The Vite dev server does not apply `_headers`, so header problems only show on the deployed site or a Pages preview.
- The Content-Security-Policy needs no new origin for speech recognition, because the browser, not page script, contacts the speech service.

### Not verified before release

No automated test covers these two points. They are checked only by the manual checklist above (items a and f):

- (a) Whether `Permissions-Policy: microphone` also governs `SpeechRecognition.start()` in each browser.
- (b) Whether the Content-Security-Policy `connect-src` affects the browser's own connection to the speech service.

### Owner steps for the voice release (manual)

Done by the project owner in their own terminal and browsers; no agent or CI step runs them.

1. `npm run build`, then `npm run check:dist`, then deploy as in "Deploy to Cloudflare Pages" (a Pages preview first is fine).
2. Fetch the response headers of `/` and of a static asset (for example `curl -I https://<project>.pages.dev/`). Confirm `Permissions-Policy: microphone=(self)`, the unchanged Content-Security-Policy, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`, each exactly once. The `/api` responses are not expected to carry them.
3. Run the voice checklist items (a) to (k) on real devices and record findings in the "Findings" table.

## Test notes

Tests run with `npx vitest --run`. Engine tests run in the default Node environment. UI tests that need a DOM use `happy-dom` (pinned to 21.0.4) through the per-file docblock `// @vitest-environment happy-dom` on the first line of the test file. The verification spike confirmed this works with the pinned Vitest 5.1.0 without any config fallback, and that Node-environment tests still see no `document`.

### Layout check (MIC visibility)

Run `npm run build` first, then `npm run check:layout`. The script serves `dist/` itself (vite preview on port 4173) and drives an installed Edge or Chrome through `playwright-core` (no browser download; set `CHROME_PATH` or `EDGE_PATH` to use a specific executable). It asserts the MIC, its disclosure and the input line stay on screen at 1280x720, 1366x768 and 1024x600, and reports other sizes without failing. It is a local script, not part of CI.

## Credits

Based on *Colossal Cave Adventure* by Will Crowther and Don Woods,
via the BSD-2-Clause [Open Adventure](https://gitlab.com/esr/open-adventure) data.
See [`original/ATTRIBUTION.md`](original/ATTRIBUTION.md).

This project is not affiliated with the 2023 game *Colossal Cave* or its publisher.

## License

Project code: MIT (see `LICENSE`).
Original game data in `original/`: BSD-2-Clause (see `original/COPYING`).
