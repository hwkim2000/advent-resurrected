# Design Document: haunting

## Overview

Haunting is built from three kinds of parts, so that 1976 mode never touches any of it:

- **Pure logic in `src/haunt`** (new, lazy chunk): key-moment detection, narrator pools, dim curve, glitch policy, yes/no aliases and nudge. No DOM, no timers, no engine RNG.
- **DOM effects in `src/ui/dom/haunt-effects.ts`** (new, lazy chunk): dim custom property, "all haunted" flash, reincarnation flicker, synthesized sound (Web Audio).
- **Small seams in `src/ui`** (always loaded, inert in 1976 mode because every hook already returns early unless `gameMode === 'haunted'`): a `TurnInfo` argument for narrator providers and observers, a non-counting deflection, and a `spoken` line kind.

Findings from the code that shape this design (checked by reading the code; nothing was run):

- `present()` in `src/ui/game-controller.ts` is the one place engine output is shown; narrator lines already go through `hooks.narratorLines(events, ctx)` and are emitted as `narrator` blocks after the original text. But providers see only `events` and `ctx`: no state, no input line, no origin. Key-moment detection needs the state before and after, so `TurnInfo` is added.
- `src/ui` may not import `src/haunt`, `src/voice`, `src/parser` or `src/shared`; `src/main.ts` may reach them only through dynamic `import()` (`tests/ui-layering.test.ts`). `src/haunt` may import only itself, `src/shared`, `src/engine`, `src/data`. So haunt code gets its DOM effects through a structural port passed in by `main.ts`, as `spoken-word-rule.ts` already does for the gate.
- `applyDeflection` always bumps the once-per-game XYZZY counter, so the yes/no nudge needs a non-counting deflection.
- The engine's `answerYesNo` already treats any first word starting with `y` or `n` as an answer ("nope", "nah", "no thanks", "yeah", "yep", "yes please" already work). Only "sure", "ok", "okay", "please" (and similar) fail today, and anything not starting with y/n gets "Please answer the question.".
- The AI context lists only room objects, not carried ones, and nothing resolves object ambiguity; the model picked FOOD for "grab the lab". The fix is deterministic code on the client, after `validateCommand`; the Worker, request schema and prompt stay unchanged (no deploy needed).
- `LineKind` has no spoken kind; autosave decode rejects unknown kinds, so a new kind must be added to `LineKind`, `LINE_KINDS`, `AUTOSAVE_LINE_KINDS`, the view class and the CSS.
- There is no speech-output or Web Audio code yet, so Requirement 1.5's "read aloud" clause has nothing to hook into and is out of scope until a voice-output spec exists. Narrator blocks already reach `notifyOutput`, which is the future attach point.
- Not verified: the MIC-below-the-fold cause (inferred from CSS, not measured in a browser); task 7 measures it first.

## Architecture

```
main.ts (dynamic imports only)
  haunting-loader.ts (src root, like ai-loader.ts)   on Haunted game start:
        import('./haunt/haunting') + import('./ui/dom/haunt-effects')
        -> createHaunting({ hooks, effects, motion, seed }).gameStart(state)
     1976 game start -> haunting.dispose(), effects.reset()
src/haunt/ (pure)                       src/ui/ (seams)               src/ui/dom/
  haunting.ts   wires hooks             extension-hooks.ts            haunt-effects.ts
  moments.ts    detect(prev,next,...)     + TurnInfo arg               setDim / flashGlitch /
  narrator.ts   pools, cooldown, picker   + deflect {count:false}      reincarnate / sting
  lines.ts      text pools              game-controller.ts           terminal-view.ts
  dim.ts        dimLevel(state)           + TurnInfo in present()       + line--spoken
  yes-no.ts     aliases + nudge gate      + spoken echo kind
  glitch.ts     visit counter policy    types.ts / autosave.ts
                                          + 'spoken' LineKind
```

A failure to load either chunk is logged and ignored; the game then runs with plain original text (Requirement 7.1). The two chunks load independently of the voice chunk.

## Components

### UI seams (src/ui)

```ts
// extension-hooks.ts
export interface TurnInfo {
  readonly before: GameState | undefined; // undefined on the first present() of a game
  readonly after: GameState;
  readonly line: string;                  // text given to the engine ('' at game start)
  readonly origin: InputOrigin;
}
export type NarratorLineProvider = (events, ctx, turn: TurnInfo) => readonly string[];
export type EventObserver = (events, ctx, turn: TurnInfo) => void;
export type GateResult = { kind: 'allow' } | { kind: 'deflect'; lines: readonly string[]; count?: false };
```

`GameState` comes from `src/engine/index` (already the only allowed engine entry). Existing providers and observers ignore the extra argument. `validDeflect` keeps `count: false`. `applyDeflection(lines, count)` bumps the counter only when `count !== false`.

Spoken echo: `echo(line, origin)` emits `kind: 'spoken'` for spoken lines (same text as `input`), added to `LineKind`, `LINE_KINDS`, `AUTOSAVE_LINE_KINDS`. The view maps kinds to `line--<kind>`; CSS draws the mic marker with `.line--spoken::before` (presentation only, not in the transcript text, so it never reaches the engine, history or speech). Every existing place that treats `input` specially must treat `spoken` the same; task 2 greps for them.

### Narrator (src/haunt)

`moments.ts` exports `detectMoments(turn, events): MomentKind[]`, pure, from state diff plus events (no engine edits):

| Moment | Detection |
|---|---|
| `treasure` | a treasure object's `place` became carried (`OBJECTS[i].isTreasure`) |
| `dwarf` | any `dwarves[1..NDWARVES-1].seen` false -> true |
| `pirate` | `dwarves[PIRATE].seen` false -> true |
| `dragon` | `objects[DRAGON].prop` became `DRAGON_DEAD` |
| `lampDim` / `lampOut` | `game.lmwarn` false -> true / `limit` became -1 |
| `maze` | original text contains the "all alike" line (first time per life) |
| `backtrack` | `room-entered` loc equals the room before the previous one |
| `death` | `death` event (cause, count) |
| `reincarnated` | `before.session.pending.k === 'croak'` and `after` is running |
| `declined` | `before.session.pending.k === 'croak'` and `after.session.status === 'over'` |
| `spokenXyzzy` | `origin === 'spoken'` and the line has the XYZZY motion word (`containsXyzzyMotionWord`) |

`narrator.ts` keeps `{turn counter, lastFiredTurn, firedThisLife: Set<MomentKind>, occurrence: Map}`. Rules: `death`, `reincarnated`, `declined`, `spokenXyzzy` bypass cooldown and per-life limits; other moments fire at most one line per turn, only if `turnsSinceLast >= COOLDOWN_TURNS` (3) and the kind has not fired this life; highest priority wins. The life counter resets on `reincarnated`. Pool choice is `pool[(hash(seed, kind) + occurrence) % pool.length]`: no PRNG state, never touches `game.lcg_x`. State is not persisted (a reload resets cooldown; acceptable).

`lines.ts` holds the pools (at least 3 per moment; death split by cause group fall / dwarf / other with escalation variants for deaths 2 and 3; reincarnation, farewell and spoken-XYZZY pools). Style: sentence case, plain ASCII (the VT323 font has limited coverage), one or two terminal lines, ghost of the program: confused by the modern world, proud, petty about the 49 years (examples of the voice: "Cloud? There is no cloud. There is a PDP-10 and a very damp ceiling." / "Spoken aloud. Nobody has spoken to me since 1977. Do it again, I was not ready."). Clean humor, no brands.

### Reincarnation scene

Order of output stays: original death text and offer (unchanged), then a death-specific narrator line. When `reincarnated` is detected, `present()` has already shown the original text; the provider adds a narrator countdown block (`REINCARNATION IN PROGRESS... 3... 2... 1...` then a quip) and the observer calls `effects.reincarnate()`: a CSS class `haunt-flicker` on `.crt` for about 1.2 s (opacity steps, no layout) plus a synthesized rising sting (Web Audio oscillator, low gain, created lazily; failure ignored). Any key or pointer press cancels the effect immediately, and the existing teletype skip reveals the narrator block at once. Total added time is under 2 s of effect and the narrator block is skippable, which meets the 4 s cap. Reduced motion: no flicker, no sound change; the countdown is plain text. The engine state is untouched.

### Dimming

`dim.ts`: `dimLevel(game)` returns 1 when the lamp is off or `limit > DIM_START (150)`, otherwise `1 - 0.4 * (1 - max(limit,0)/150)`, floor `DIM_FLOOR = 0.6` (limit -1 or 0 gives the floor). Fresh batteries raise `limit`, so the level recovers by itself. The observer calls `effects.setDim(level)` every turn and `gameStart` syncs once from `controller.engineState` (covers restored games). `effects.setDim` writes `--haunt-dim` on `documentElement`; CSS `html[data-game-mode="haunted"] .crt { filter: brightness(var(--haunt-dim, 1)) }` (transition 0.8 s, none under reduced motion, where the value simply steps). Scoping to `data-game-mode="haunted"` keeps it inert in 1976 mode. Floor 0.6 keeps `--fg` and `--narrator` text above 4.5:1 against `--bg` (computed: about 5.4:1 for `--fg`); the secondary `--fg-dim` notice color is below 4.5:1 at the floor, which is accepted because the requirement targets normal text. A unit test computes this from the CSS tokens.

### Maze glitch

An output listener (fires after a block finishes revealing, `kind === 'original'`) checks for "all alike" and asks `glitch.ts` (visit counter: glitch on visit 1, then every 4th) whether to fire. `effects.flashGlitch()` finds the last `.line--original` element containing "all alike", swaps the text node data to "all haunted" for 1000 ms, then restores the exact original string (restore only if the node still holds the glitched text). Because only the DOM text node changes, the `Transcript`, autosave, engine, AI and any future speech see the original. Reduced motion: no flash; the narrator `maze` line covers it.

### Yes/no aliases and nudge (src/haunt/yes-no.ts)

- Input transformer (Haunted mode only, `ctx.prompt === 'yesno'`): normalize (lowercase, trim, strip punctuation) and map whole-line aliases: YES for sure, ok, okay, please, yeah, yep, yup, absolutely, of course, why not, yes please; NO for nope, nah, no thanks, no thank you, never. The engine receives `YES` or `NO`.
- Input gate (same condition): after transforming, if the first word does not start with `y` or `n` (what the engine would reject), return `{ kind: 'deflect', lines: [nudge], count: false }` without calling `step`. The question is still pending, so nothing else changes. At least 3 nudges, rotated, each ending with a clear "YES or NO" cue. 1976 mode never reaches the gate, so the engine's original text shows.

### XYZZY hint

`DEFLECTION_LINE` in `spoken-word-rule.ts` becomes a funny narrator-voice line that still says: say it aloud, hold the mic or Alt+M, or type it again. Constraints: at most 160 characters (fits two lines), still a single exported constant, tests that assert its old length or uppercase are updated. A `spokenXyzzy` narrator reaction is added (Requirement 5.1).

### AI object disambiguation (src/shared + src/parser)

- `src/shared/edit-distance.ts`: move `damerauLevenshtein` (OSA) out of `src/voice/edit-distance.ts`; the voice file re-exports it so voice code and tests keep working.
- `src/shared/object-match.ts`: `pickClosestObject(playerText, modelCommand, candidates)`.
  1. Tokens: lowercase letters of the player text, length >= 2, minus a small stop list (the, a, an, to, at, up, my, some, that, this, it, with, from, please, and) and minus tokens that are classic verbs or motions.
  2. If any token supports the model's object (shares a >= 3 letter prefix with one of that object's words, or `distance < token.length` and `distance <= 2`), keep the model's command.
  3. Otherwise score every candidate (visible or carried objects) word against every token: rank by exact prefix match, then smaller distance (accepted only if `distance <= 2` and `distance < token.length`), then candidate order. Replace the object word with the winner's canonical `words[0]` and re-run `validateCommand`; if it is not valid, keep the model's command.
  4. No candidate within the bound: unchanged.
  Worked example: "grab the lab" -> model says `TAKE FOOD`; token `lab` does not support FOOD (distance 4); `lab`->`lamp` is distance 2 (< 3), so with the lamp visible the result is `TAKE LAMP`.
- Wiring: in `AiParser.run`, after `interpret(raw)` yields `translated`, compute candidates from `input.state` (room objects as in `visibleObjectIndexes`, plus carried objects, none room-side if dark) and apply `pickClosestObject`. The request body and `buildGameContext` stay unchanged.

### MIC visibility (CSS)

The voice bar is the last `flex: none` child of a column that clips, and its disclosure paragraph wraps to several lines, while the CRT padding and text size scale with viewport width only. Changes (measure first, then adjust):
- vertical screen padding from height: `padding-block: clamp(0.5rem, 2vh, 1.5rem)`; text size `clamp(18px, min(2.4vw, 3.4vh), 26px)`.
- `.voice-bar`: mic button and status on one row; the disclosure stays visible but smaller (`font-size: max(14px, 0.65em)`, tight line height). The text and the element id are unchanged, so `check:dist` still passes.
- `@media (max-height: 700px)`: `.controls` single row with smaller gaps.
Verification: `scripts/check-layout.ts` drives the built site in a real Chromium-based browser (via `playwright-core`, `channel: 'msedge'`/`'chrome'`, no browser download) at 1280x720, 1366x768 and 1024x600, un-hides the mic elements, and asserts `#mic`, `#mic-disclosure` and the input line are fully inside the viewport. It is a local script, not part of CI.

## Testing strategy

- Example tests (required): moments detection on constructed `GameState` diffs and on real engine runs; narrator cooldown and per-life limits and determinism; dim curve bounds and monotonicity plus the contrast computation; yes/no aliases and the nudge gate (non-counting deflection, XYZZY counter intact); controller tests for `spoken` echo (persisted and restored), `TurnInfo` delivery, and 1976 mode emitting no narrator, no spoken-marker class issues, and no hook calls; `pickClosestObject` including "grab the lab"; glitch restores exact text; layering and lint tests still pass.
- Property tests (optional): narrator never changes or reorders original text; no narrator output in 1976 mode; dim level monotone in `limit`; engine state after any input is identical with and without haunting installed.
- Fidelity and walkthrough suites run unchanged; `check:dist` gets a haunt-chunk isolation check (marker string absent from the start script, present in a lazy chunk).
