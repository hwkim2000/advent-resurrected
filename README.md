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

### Privacy

- In Haunted mode, a line that is not a classic command is sent to Cloudflare Workers AI, a third-party service, with a short description of the game (room name, visible objects, and the last two accepted commands).
- 1976 mode sends no player input to any service.
- Classic commands are never sent to the AI.
- Nothing else about the player or the game is sent.

The same text is on the credits page.

`public/_headers` sets a same-origin Content-Security-Policy (`connect-src 'self'`); the AI call goes to this site's own `/api/parse`, so it needs no wider policy. Later specs (microphone) may add a `Permissions-Policy`.

### Manual checklist (real devices)

- On-screen keyboard works on iOS Safari and Chrome on Android (input stays visible, no zoom on focus).
- No horizontal scroll at 320 px and at 1920 px widths.
- The CRT curvature keeps every character visible on small screens.
- The visual feel of the effects is right: scanlines, glow, flicker, blinking block cursor, and the CRT toggle and reduced-motion settings.
- Typing, command history (Up/Down), the boot skip, 1976/Haunted mode switch, and the Credits link all work.

## Test notes

Tests run with `npx vitest --run`. Engine tests run in the default Node environment. UI tests that need a DOM use `happy-dom` (pinned to 21.0.4) through the per-file docblock `// @vitest-environment happy-dom` on the first line of the test file. The verification spike confirmed this works with the pinned Vitest 5.1.0 without any config fallback, and that Node-environment tests still see no `document`.

## Credits

Based on *Colossal Cave Adventure* by Will Crowther and Don Woods,
via the BSD-2-Clause [Open Adventure](https://gitlab.com/esr/open-adventure) data.
See [`original/ATTRIBUTION.md`](original/ATTRIBUTION.md).

This project is not affiliated with the 2023 game *Colossal Cave* or its publisher.

## License

Project code: MIT (see `LICENSE`).
Original game data in `original/`: BSD-2-Clause (see `original/COPYING`).
