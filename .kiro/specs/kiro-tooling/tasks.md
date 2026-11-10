# Implementation Plan: kiro-tooling

## Overview

Order: MCP session and server with tests, MCP config and demo client, line lint and hooks, pre-deploy script, final checkpoint. No optional tasks. Rules for every task:

- Do NOT commit, push or deploy. No `wrangler`, no network calls. Do not modify `src/engine`, `src/data`, `original/`, `reference/`, `public/voice/`, `wrangler.toml`, `migrations/`. The Vite build and the 1976 start script must not change (task 6 verifies the main chunk size is identical).
- New dependencies exactly pinned (no `^`/`~`): `@modelcontextprotocol/sdk` 1.32.2 and `zod` 4.6.7 as devDependencies only.
- Files use kebab-case. `tools/` files are new code (note "New code; not ported from Open Adventure" in a header comment). MCP stdout carries protocol messages only.
- Existing suites must keep passing, including `tests/lint.test.ts`, `tests/ui-layering.test.ts`, `tests/voice/layering.test.ts`, `tests/repo/repo-scan.test.ts`.

## Tasks

- [x] 1. MCP session and server
  - [x] 1.1 Add the pinned dependencies, scripts `mcp:advent` and `mcp:demo`, and `tools` in the root `tsconfig.json` `include`. Read `src/engine/index.ts`, `src/engine/types.ts`, `cli/advent-cli.ts` (Storage/Env usage), `src/engine/score.ts` if present (to find a side-effect-free score function), `src/haunt/hint-view.ts` and `src/haunt/hints.ts` first, and verify every identifier the session uses.
  - [x] 1.2 Create `tools/advent-mcp/session.ts` per the design (MemoryStorage, newGame/send/getState/askGhost, prompt kind, validation, no mutation of state by getState/askGhost).
  - [x] 1.3 Create `tools/advent-mcp/server.ts` per the design (four tools, zod schemas, tool errors, protocol-only stdout).
  - [x] 1.4 Example tests in `tests/tools/` for the session and, through an SDK in-memory client/server pair, for the four tools and error paths; verify `getState`/`askGhost` leave `serialize(state)` unchanged and that no file is written (spy or temp-dir check for SAVE).

- [ ] 2. Kiro MCP config and demo client
  - [ ] 2.1 Create `.kiro/settings/mcp.json` per the design.
  - [x] 2.2 Create `tools/advent-mcp/demo-client.ts`: spawns the server over real stdio (SDK `StdioClientTransport`, absolute script path, `npx`-free: use `process.execPath` with `--import tsx` or `npx tsx` ??whichever works on Windows; verify), calls `new_game` (seed 1, mode `haunted`), then plays at least 20 turns of `send_command` (answer the instruction prompt, enter the building, take lamp/keys/food/bottle, light the lamp, leave, walk toward the grate, etc. ??use commands that actually work; check the output as you go), interleaving `get_state` and `ask_ghost` a few times, and prints a readable transcript (`> command`, output). Do not run it yet in this task.
  - [ ] 2.3 Add a structural test for the config file (valid JSON, server `advent`, command/args shape, `autoApprove` lists exactly the four tool names that `server.ts` registers).

- [x] 3. Line lint and hooks
  - [x] 3.1 Create `tests/haunt/line-lint.test.ts` per the design (reuse existing banned-word lists where exported; otherwise add a small shared constant in a test support file and keep `tests/haunt/narrator.test.ts` untouched unless a trivial import is cleaner).
  - [x] 3.2 Create `.kiro/hooks/engine-fidelity.json`, `.kiro/hooks/line-lint.json` (v1 shape, `PostFileSave`, matcher regexes working with `/` and `\`, command actions, sensible `timeout`), and `.kiro/hooks/predeploy.json` (trigger `Manual`, command `npm run predeploy`, own file).
  - [x] 3.3 Create `tests/tools/kiro-config.test.ts` that parses every `.kiro/hooks/*.json`: shape, unique names, valid regexes, matchers accept sample engine/line-file paths with both separators and reject unrelated ones (e.g. `src/ui/crt.css`, `src/engine-notes.md`); the manual hook is alone in its file.

- [x] 4. Pre-deploy script
  - [x] 4.1 Create `scripts/predeploy.ts`, `scripts/start-script-baseline.json` and the `predeploy` npm script per the design, with the pure helpers exported and unit tested in `tests/scripts/predeploy.test.ts` (entry script discovery from an `index.html` fixture, size report formatting, delta sign, missing baseline).
  - [x] 4.2 Run `npm run build` once and verify the entry-script discovery and the size report against the real `dist/` by running the report part only (do NOT run the full predeploy chain unless it passes quickly; if you run it, report the result).

- [ ] 5. Proof run (report only)
  - [ ] 5.1 After task 1-4 pass typecheck and tests, run `npm run mcp:demo` for real and capture the complete transcript. Confirm each of the four tools was called over stdio at least once and that the 20 turns are real engine output. Return the full transcript verbatim in your reply (do not summarize it).

- [ ] 6. Final checkpoint: `npm run typecheck`, `npx vitest --run`, `npm run build`, `npm run check:dist`. Confirm `dist/assets/main-*.js` is 236,114 bytes raw like before (tools/.kiro are not bundled). List `git status --short` and confirm nothing in the protected directories changed. Do not commit or deploy.
