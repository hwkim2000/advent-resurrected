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

These steps are instructions for the **manual first deploy**, done by you. The repository's tasks and CI never deploy, and nothing in the repo holds Cloudflare credentials. `wrangler.toml` contains only non-secret Pages settings (`name`, `pages_build_output_dir`, `compatibility_date`).

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
5. No environment variables or secrets are needed for this build.

`public/_headers` sets a same-origin Content-Security-Policy (`connect-src 'self'`). Later specs (AI proxy Worker, microphone) will widen `connect-src` and add a `Permissions-Policy`.

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
