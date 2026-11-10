# Design Document: ghost-hints

## Overview

Everything funnels into one text, `GHOST`, handled by one Haunted-mode input gate:

```
typed/spoken line
  "ghost, where do I go?" ---> eligibility: pass (no AI) ---+
  "I'm stuck" (exact list) --> eligibility: pass -----------+--> deliver('GHOST' or original line)
  "any other help question" -> AI -> Worker replies GHOST --+        transformInput -> gateInput
        client: decoded 'GHOST' => translated 'GHOST'                  ghost gate (src/haunt/ghost-hints.ts)
        controller shows dimmed "GHOST" translation, delivers it        -> deflect { lines:[hint], count:false }
                                                                      -> narrator line(s), spoken by ghost voice
```

The controller, hooks and engine need no change: a gate `deflect` with `count: false` (spec 5) skips `step`, leaves the engine state, RNG, score and deflection counter alone, and emits the lines as `narrator` blocks, which spec 6 already speaks.

## Components

### src/shared/ghost-ask.ts (pure, shared by parser and haunt chunks)
- `GHOST_TOKEN = 'GHOST'` (the reserved word).
- `isGhostPrefixAsk(text)`: first word is `ghost` (case-insensitive, with optional leading "hey"/"oh", trailing punctuation); does not match "ghostly".
- `GHOST_PHRASES` (exact, normalized: lowercase, apostrophes dropped, trailing `?!.` stripped): i'm stuck / im stuck / i am stuck, what now, what do i do, where do i go, help me.
- `isGhostAsk(text)`: prefix, phrase, or the token `GHOST` itself.
Check that `ghost` is not a game vocabulary word (`lookupWord`) and that no phrase is a classic command (`isClassicCommandText`); a test asserts both.

### Parser (src/parser, lazy AI chunk)
- `eligibility.ts`: `classifyInput` returns `pass` for `isGhostPrefixAsk` and phrase matches (no request). Plain `HELP`/`INFO` are classic and already pass.
- `ai-parser.ts` `interpretResponse`: after `decodeSuccess`, if the decoded value (trimmed, uppercased) is `GHOST`, return `{ kind: 'translated', command: 'GHOST' }` before `validateCommand`. `CommandMemory.accepted('GHOST')` is a no-op because it is not a valid command (verify).

### Worker (src/parse-api)
- `prompt.ts`: one output rule ("If the player asks for help, a hint, or says they are stuck or lost, reply GHOST") and two examples ("I'm totally lost, any hints?" -> `GHOST`, "what should I do next" -> `GHOST`) placed after the existing 8; the existing examples are untouched. A matching non-example guard: "help" words in a real command ("help the bird"?) are not covered by examples; the rule says plain game commands still map normally.
- `handler.ts`: after `provider.translate`, if the trimmed uppercased output equals `GHOST_TOKEN`, answer 200 `encodeSuccess('GHOST')`; otherwise the existing `validateCommand` path (a missing/odd output stays 422 `no_command`).
- `src/shared/protocol.ts` and request validation unchanged. `tests/parse-api/config-prompt.test.ts` recomputes prompt cost; if the added tokens push the arithmetic over its limit, report the numbers and adjust `DAILY_CAP` only as that test demands, mentioning it.

### Hints (src/haunt)
- `hint-view.ts`: `makeHintView(state: GameState): HintView` read-only booleans and ids: `loc`, `region` (outside/building/cave/deep/maze via `indeep`, `outside`, location id sets), `dark`, `hasLamp`, `lampLit`, `lampLow` (`game.lmwarn` or `limit` small), `hasKeys`, `hasFood`, `hasWater`, `hasCage`, `hasBird`, `hasRod`, `hasAxe`, `grateUnlocked`, `snakeGone`, `dragonDead`, `trollPaid`/bridge, `pirateSeen`, `chestFound`, `treasuresCarried`, `treasuresFound` (`tally`), `closing`. Exact identifiers and values come from `src/engine/types.ts`, `src/data/constants.ts` and `src/engine/objects.ts`; the implementer verifies each (the property names above are a plan, not a fact).
- `hints.ts`: `HINT_RULES: readonly { id; when(view): boolean; lines: readonly string[] }[]` in priority order, ending with `fallback` (always true). `HINT_POOLS` exports every line for tests and the voice list. About 16 to 20 rules with 2 to 3 lines each plus a 3-line fallback (40 to 60 lines total). Topics (nudges only, no solutions): start of the game / building / lamp not lit or no lamp underground (dark), dead or low lamp, grate locked or keys, debris and the cave entrance, bird and cage, snake in the Hall of the Mountain King, maze, dragon, troll bridge and treasure, carrying treasure above ground (the building), pirate and the chest, the closing cave, plus the fallback. Ordering puts urgent situations (dark, low lamp, closing) before location-specific ones, then inventory-based, then region defaults.
- `ghost-gate.ts`: `createGhostGate({ getState, seed })` returns an `InputGate`: at the command prompt in Haunted mode, if `isGhostAsk(text)`, evaluate `HINT_RULES` on `makeHintView(getState())`, pick the variant by `occurrence[ruleId]++ % lines.length` (deterministic, per game, no engine RNG, reset by `gameStart`), and return `{ kind: 'deflect', lines: [line], count: false }`. No state, no mutation of the argument; any throw -> `allow` (the line then reaches the engine as ordinary input).
- `haunting.ts`: `HauntingDeps` gets `getState(): GameState | undefined`; the gate is registered before the yes/no gate (it only acts at the command prompt). `src/haunting-loader.ts` supplies `getState` from `controller.engineState` (the host already has it).

### Voice
`src/haunt/voice-lines.ts` includes `HINT_POOLS` in `voiceLines()`. `MAX_TOTAL_BYTES` in `scripts/gen-voice.ts`, the total-size test and the README change from 3 MB to 4 MB. Existing 55 files are kept by the incremental generator; only the new lines are generated (owner step). The manifest sync test fails until then, by design.

### Evaluation script
`scripts/eval-parser.ts` (`npm run eval:parser -- <base-url>`): builds contexts, posts to `<base-url>/api/parse`, sleeps 2.5 s between requests, compares results (expected command, `GHOST`, or `no_command`), prints a table and totals, exits non-zero under 100 percent so the owner sees any miss. Fixtures live in `scripts/eval-parser-cases.ts` (about 20 + 8 + 6 cases; the original 20 sentences are not in the repo, so the cases are new). Pure helpers (case list, scoring) are unit tested; the network part never runs in tests.

## Testing strategy
Example tests per Requirement 5. State-based rules use constructed `GameState` objects derived from `newGame` plus targeted field edits (same technique as `tests/haunt/moments-helpers.ts`) and a few real engine replays. A property test (optional) is not planned. `check:dist` gets `HINT_TABLE_MARKER` absent from the start script and present in a lazy chunk.
