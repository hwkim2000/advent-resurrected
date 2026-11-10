# Requirements Document

## Introduction

Spec 8 adds developer tooling around the game, not game features: a local MCP server so an agent can play the real engine, Kiro hooks that run the right checks when files change, and a pre-deploy check. Nothing here ships to players: `tools/` and `.kiro/` are not part of the Vite build, `dist/` is unaffected, and the 1976 start script cannot change.

Facts checked about this Kiro version (from the Kiro docs via the introspection agent; not run in this environment):

- Workspace MCP servers are declared in `.kiro/settings/mcp.json` (`mcpServers`, with `command`, `args`, `env`, `disabled`, `autoApprove`). The docs list no `cwd` field and do not say whether relative paths resolve against the workspace root, so the server resolves its own paths from its file location and the config uses a workspace-relative script path (assumption flagged, not verified here).
- Hooks are JSON files in `.kiro/hooks/` (`{version:"v1", hooks:[{name, trigger, matcher?, action:{type:"command"|"agent",...}, timeout?}]}`; several hooks per file). `PostFileSave` matchers are regexes over the file path, and file events fire only for changes made by the agent, not manual editor saves. A `Manual` trigger is accepted in the format, but the CLI cannot invoke it ("`/hooks` doesn't provide an action to invoke them"), so the pre-deploy check is also available as an npm script.
- I could not run Kiro's own MCP or hook loader here. The MCP server is proven over a real stdio client; the hook files are validated structurally only.

## Requirements

### Requirement 1: MCP server

1. `tools/advent-mcp/` SHALL contain a stdio MCP server (Node, TypeScript, run with `tsx`) built on the official MCP TypeScript SDK (pinned exactly) that drives the existing engine through its public API (`src/engine/index`) and changes nothing in `src/engine`.
2. Tools:
   - `new_game(seed?, mode?)`: starts a game (`mode` `1976` or `haunted`, default `1976`; `seed` a signed 32-bit integer, default a fixed seed so runs are reproducible) and returns the opening text and the prompt kind.
   - `send_command(text)`: gives one line to the engine and returns the output text exactly as the classic game prints it (no narrator or hint lines added), plus the prompt kind and whether the game is over. Input is limited to 1023 characters.
   - `get_state`: read-only summary: location (id and name), inventory, score, turns, lamp (lit, remaining life), key flags (grate, bird, snake, dragon, troll/bridge, pirate/chest, cave closing), lives used, prompt kind, game over.
   - `ask_ghost`: the hint the game's ghost would give right now (rule id and the first variant), computed from the current state without changing it (no variant counter, no engine call). In `1976` mode it says that the ghost only exists in Haunted mode.
3. The session lives in memory only. SAVE/SUSPEND write to an in-memory store, never to disk. The server reads and writes no files, makes no network calls and logs nothing to stdout except MCP protocol messages.
4. Errors (no game started, bad seed, too-long input, game over) SHALL be returned as MCP tool errors with a clear message, never crash the server.
5. A project-level config `.kiro/settings/mcp.json` SHALL register the server as `advent` (`autoApprove` for the four tools, since the game is local and harmless).

### Requirement 2: Hooks

1. Hook files under `.kiro/hooks/`:
   - **Engine fidelity:** `PostFileSave` for files under `src/engine/`, `src/data/`, `original/` or `scripts/generate-data.ts` runs the upstream fidelity replay and walkthrough tests.
   - **Line lint:** `PostFileSave` for the narrator, hint, nudge, deflection and voice-line files (`src/haunt/lines.ts`, `hints.ts`, `yes-no.ts`, `spoken-word-rule.ts`, `voice-lines.ts`) runs a line lint (at most 160 characters, plain ASCII, no banned brand words such as Zork or Colossal Cave, no empty or duplicate lines) and the voice manifest sync check.
   - **Pre-deploy (manual):** a `Manual` hook file that runs the pre-deploy check, kept in its own file so an unsupported trigger cannot affect the other hooks.
2. Matchers SHALL work with both `/` and `\` path separators.
3. The line lint SHALL be a normal Vitest test over `voiceLines()` and the pools, so it also runs in the full suite and in CI.

### Requirement 3: Pre-deploy check

1. `npm run predeploy` SHALL run, in order, typecheck, the full tests (single run), build and `check:dist`, stop at the first failure, and then print the 1976 start-script size (raw and gzip bytes of the `main-*.js` that `dist/index.html` loads) and its difference to a recorded baseline. It never deploys and never touches the network.

### Requirement 4: Proof and tests

1. Tests SHALL cover the session logic (new game, commands, state summary, hint peek that leaves state unchanged, 1976 vs Haunted, errors, in-memory save) and the server through an in-memory MCP client, plus a stdio smoke test only if it can run without network.
2. After the implementation, the server SHALL be exercised over real stdio by a demo client that plays the first 20 turns and prints the transcript (including `get_state` and `ask_ghost` calls). The transcript is reported to the owner. It is produced by a script client, because this session cannot load Kiro's own MCP integration.
3. Existing suites (fidelity, walkthrough, layering, lint, check:dist) keep passing; nothing is committed or deployed by this spec's tasks.
