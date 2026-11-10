# Design Document: kiro-tooling

## Overview

```
tools/advent-mcp/
  session.ts      pure game session (engine + in-memory Storage), no MCP imports
  server.ts       MCP stdio server: registers 4 tools, thin adapters over session.ts
  demo-client.ts  real stdio client (SDK StdioClientTransport) playing 20 turns, prints the transcript
.kiro/settings/mcp.json        registers `advent`
.kiro/hooks/engine-fidelity.json   PostFileSave -> fidelity + walkthrough tests
.kiro/hooks/line-lint.json         PostFileSave -> line lint + manifest sync
.kiro/hooks/predeploy.json         Manual -> npm run predeploy (own file)
scripts/predeploy.ts           typecheck, tests, build, check:dist, then size report
tests/haunt/line-lint.test.ts  consolidated line lint over voiceLines() and the pools
tests/tools/                   session and server tests
```

Facts from the code (read, not all run): the public engine API is `newGame(seed, {oldstyle})`, `start(state, env)`, `step(state, line, env)`, `render(events, {echo:false})`, `serialize`; `Env` needs a `Storage` (read/write by name, see `cli/advent-cli.ts` `FileStorage`); `src/haunt/hint-view.ts` (`makeHintView`) and `hints.ts` (`selectHintRule`, `HINT_RULES`) are pure over `GameState`; layering tests scan `src/` only, so `tools/` may import `src/engine`, `src/haunt`, `src/data` and `src/shared`. `cli/advent-cli.ts` already shows how to drive the engine from Node, which `session.ts` follows (no Node APIs in `src/engine`).

## Components

### session.ts
`class GameSession`: `{ state?, mode, seed }`.
- `newGame(seed = DEFAULT_SEED, mode = '1976')`: validates seed (signed 32-bit integer), `newGame(seed, {oldstyle: mode === '1976'})`, `start(...)`, stores state; returns `{ text, prompt, over }` where `text = render(events, {echo:false})`. `DEFAULT_SEED = 1`.
- `send(text)`: rejects when no game, text longer than 1023 characters, or the game is over (message: start a new game); runs `step`, returns `{ text, prompt, over }`. Output is the classic engine text only.
- `getState()`: returns a plain object from engine fields plus `makeHintView`: `location {id, name}`, `inventory[]` (object names via `OBJECTS`), `score` (use the engine's score function if exported/accessible without side effects; otherwise the last `score` event; the implementer verifies and documents which), `turns`, `lamp {lit, life}`, `flags {grateUnlocked, birdCaught, snakeGone, dragonDead, trollGone/bridge, pirateSeen, chestFound, closing}`, `lives {used, max}`, `prompt`, `over`, `mode`, `seed`. Read-only: never mutates `state`.
- `askGhost()`: `selectHintRule(makeHintView(state))` and `lines[0]`; returns `{ rule, hint }`; in 1976 mode returns `{ ghost: false, message }`. No counters.
- Storage: `MemoryStorage` implementing the engine `Storage` interface, so SAVE/SUSPEND/RESUME stay in memory.
- Prompt kind from the last `prompt` event (`command` | `yesno` | `filename`).

### server.ts
Uses the SDK `McpServer` + `StdioServerTransport`, zod input schemas (`seed: z.number().int().optional()`, `mode: z.enum(['1976','haunted']).optional()`, `text: z.string().max(1023)`), each handler wraps `GameSession` in try/catch returning `{ content:[{type:'text', text}], isError:true }` on error. Output for `send_command` is the game text followed by a one-line footer such as `[prompt: command | turns: 3 | over: no]`. `get_state` and `ask_ghost` return pretty JSON text (and `structuredContent` if the SDK version supports output schemas simply). Nothing is written to stdout except protocol messages; diagnostics go to stderr only on fatal startup errors.

### Dependencies
`@modelcontextprotocol/sdk` 1.32.2 and `zod` 4.6.7 as exact-pinned devDependencies (zod is an SDK peer). Add `tools` to the `include` list of the root `tsconfig.json` so typecheck covers it. npm scripts: `mcp:advent` (`tsx tools/advent-mcp/server.ts`) and `mcp:demo` (`tsx tools/advent-mcp/demo-client.ts`).

### .kiro/settings/mcp.json
```json
{ "mcpServers": { "advent": { "command": "npx", "args": ["tsx", "tools/advent-mcp/server.ts"],
  "autoApprove": ["new_game", "send_command", "get_state", "ask_ghost"], "disabled": false } } }
```
`npx` resolves `tsx` from the project's `node_modules`. Relative script path resolution against the workspace root is the unverified assumption noted in the requirements; the demo client uses an absolute path.

### Hooks
Files per Requirement 2; commands run from the project root: `npx vitest --run tests/fidelity.test.ts tests/walkthrough.test.ts` and `npx vitest --run tests/haunt/line-lint.test.ts tests/voice-manifest-sync.test.ts`. Matchers: `(^|[\\/])(src[\\/](engine|data)[\\/]|original[\\/]|scripts[\\/]generate-data\.ts$)` and `(^|[\\/])src[\\/]haunt[\\/](lines|hints|yes-no|spoken-word-rule|voice-lines)\.ts$`. The two PostFileSave hooks use the `createHook` mechanism's v1 file shape; the manual hook file is written by hand with trigger `Manual`. A structural test parses all `.kiro/hooks/*.json` and `.kiro/settings/mcp.json`, checks shape, that matchers are valid regexes, and that matchers accept both separator styles for sample paths.

### Line lint (tests/haunt/line-lint.test.ts)
Over `voiceLines()` and every exported pool (`ALL_POOLS`, `HINT_POOLS`, `NUDGE_LINES`, `DEFLECTION_LINE`, `REINCARNATION_COUNTDOWN`): non-empty, trimmed, at most 160 characters, plain ASCII (printable), no duplicates, no banned words (`zork`, `colossal cave`, plus the list already used by `tests/haunt/narrator.test.ts`; reuse it if exported, otherwise keep both lists aligned by importing a shared constant added to the test support file). Original-game text is not linted (only narrator-side lines).

### scripts/predeploy.ts
Runs `npm run typecheck`, `npx vitest --run`, `npm run build`, `npm run check:dist` sequentially with inherited stdio; first non-zero exit stops with a clear summary. Then finds the entry script from `dist/index.html`, prints raw and gzip size, and the delta to `scripts/start-script-baseline.json` (`{ "raw": 236114, "gzip": 54569 }`, recorded from the last measured build; informational, never fails). Pure helpers (`findEntryScript`, `formatSizeReport`) are unit tested. It does not deploy and makes no network call.

## Testing strategy
`tests/tools/session.test.ts`: opening text equals the engine's own start output; a scripted sequence matches direct `step` calls; `get_state` before/after a hint leaves `serialize(state)` identical; `ask_ghost` identical on repeated calls; modes; error cases; SAVE does not touch the disk. `tests/tools/server.test.ts`: SDK `Client` + `InMemoryTransport` pair lists the four tools and exercises them. Hook and config structure test. Predeploy helper tests. The stdio demo is run once by the implementer and its real output reported.
