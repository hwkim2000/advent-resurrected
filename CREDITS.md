# Credits

ADVENT: Resurrected builds on the work of others. This file lists the third-party assets and their licenses.

## Font: VT323

- Typeface: **VT323**
- Author: Peter Hull (The VT323 Project Authors), copyright 2011
- License: **SIL Open Font License, Version 1.1** (OFL)
- Bundled in this repository: the font file is `public/fonts/VT323-Regular.woff2` (Latin subset, weight 400), and the full license text is `public/fonts/OFL.txt`, next to it. The font is served from the same origin as the page.
- License source: https://raw.githubusercontent.com/google/fonts/main/ofl/vt323/OFL.txt (copied unchanged)
- Font file source: the npm package `@fontsource/vt323@5.3.0`, file `files/vt323-latin-400-normal.woff2`, copied unchanged and renamed. The package is not a dependency of this project.

## Game data and logic: Open Adventure

- The game text, map and object data (`original/adventure.yaml`) and the game logic ported to TypeScript come from **Open Adventure** (https://gitlab.com/esr/open-adventure), licensed under the **BSD 2-Clause License**.
- Copyright (C) 1977, 2005 by Will Crowther and Don Woods; YAML conversion and maintenance by Eric S. Raymond.
- Open Adventure is a forward-port of *Adventure 2.5* (1995) by Will Crowther and Don Woods, the last version of the original *Colossal Cave Adventure* written by its original authors. The original authors gave permission and encouragement for this release.
- See `original/ATTRIBUTION.md` for details and `original/COPYING` for the license text.

## AI parser and privacy

In Haunted mode, an AI parser turns a natural sentence into a classic command. It runs on Cloudflare Workers AI, a third-party service.

- What is sent: when your line is not already a classic command, the line you typed or spoke is sent to Cloudflare Workers AI, a third-party service, together with a short description of the game state (the room name, the objects you can see or carry, and your last two accepted commands).
- 1976 mode sends no player input to any service.
- Lines that are already classic commands are never sent, so they stay on your device.
- Nothing else about the player or the game is sent. No account, cookie or identifier is used, and your address is stored only as a salted hash for rate limiting.
- If the AI is unavailable, the game falls back to the classic two-word parser.

## Voice input and privacy

In Haunted mode you can speak commands. Browsers that support it show a microphone button.

- In Haunted mode, voice input uses the speech recognition service of the maker of the browser. The audio is sent to that service for recognition; which company that is depends on the browser.
- This site never records or stores audio. A line you speak is stored like a line you type.
- 1976 mode never uses the microphone.
- If voice does not work, typing always works.
