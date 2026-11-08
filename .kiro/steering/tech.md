# Tech

## Stack
- TypeScript (strict) + Vite
- Vitest for tests, with property-based tests via fast-check
- Deploy: Cloudflare Pages (frontend) + Cloudflare Workers (API proxy)
- Browser APIs: Web Speech API (SpeechRecognition for input, speechSynthesis for output), CSS/Canvas for CRT effects, Web Audio for synthesized sound

## Game engine rules
- Game data comes from `original/adventure.yaml` (BSD-2). Never modify anything in `original/`. Derive build-time generated data from it elsewhere (e.g. a script that emits TypeScript/JSON under `src/`).
- Game logic must be a faithful port of Open Adventure's C source (BSD-2) to TypeScript. The full 430-point game must be completable.
- The engine is pure and deterministic: state + command + injected RNG -> new state + output. No DOM, network, or timers in engine code.
- Keep BSD-2 copyright notices on ported code.
- Port Open Adventure's exact RNG (the LCG in `misc.c`: `set_seed`, `get_next_lcg_value`, `randrange`, with the same constants and the same call order) so seeded runs are reproducible and match upstream. Do not substitute `Math.random` or another PRNG in the engine. Use 32-bit-safe integer math (`Math.imul`, `| 0`, or BigInt) to match C overflow behavior.

## Reference source (read-only)
- `reference/open-adventure/` holds an unmodified copy of Open Adventure (master, commit e6160529e70a8c7a06b9a5f190d69aa35c4c62f5): C sources, `tests/` (`.log` input scripts and `.chk` expected outputs), and its `COPYING` (BSD-2).
- Treat `reference/` as read-only, like `original/`. Never edit it. Files are byte-exact with LF line endings (`.gitattributes` sets `-text`); do not reformat or re-checkout with CRLF conversion.
- Port from these C files; cite the C function in a comment on each ported function.

## Security
- API keys never ship to the browser. All AI calls go through a Cloudflare Worker; keys live in Worker secrets (`wrangler secret`), never in the repo, `.env` files that are committed, or Vite `VITE_*` variables.
- The Worker validates input size, rate limits, and returns only a command string (constrained to the known vocabulary).
- Pin dependency versions exactly.

## Voice input
- The speech-to-text provider (browser Web Speech API vs a hosted STT service called through the Worker) is undecided and will be chosen in the voice spec. Keep the voice layer behind a provider-agnostic interface so either can be used.
- Either way, magic words (XYZZY, PLUGH, PLOVER, FEE FIE FOE FOO) must be fuzzy-matched against the transcript, because speech engines mis-transcribe them (e.g. "zizzy", "plover" -> "plover's", "fee fi fo fum"). Support phonetic/edit-distance matching and alias lists, with tests. The fuzzy matching applies only to voice transcripts; typed input uses the exact classic parser.

## Testing
- **Primary fidelity test**: a Vitest suite that discovers every `.log` in `reference/open-adventure/tests/`, replays it through the TypeScript engine (using the same seed and options the upstream test harness uses; see `tests/Makefile`), and compares the output to the matching `.chk` file. Every upstream log must pass; a failure means the port is wrong, not the test.
- Vitest unit tests for engine and parser.
- fast-check properties, e.g.: engine never throws on arbitrary input; score never exceeds 430; state serialization round-trips; AI output is always mapped to a valid command or rejected.
- A walkthrough test that plays the full game to 430 points with a seeded RNG.
- Run tests with a single run (`vitest --run`), not watch mode.

## Resilience
- Every enhanced feature (voice in, voice out, AI) must degrade gracefully to typing and the classic parser.
- Target modern Chrome/Edge/Safari; feature-detect speech APIs.
