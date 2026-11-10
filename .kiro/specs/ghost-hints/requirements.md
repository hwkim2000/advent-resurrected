# Requirements Document

## Introduction

Spec 7 lets a player in Haunted mode ask the ghost for help ("ghost, where do I go?", "ghost help", "I'm stuck", "what now"). The answer is a sarcastic nudge picked from a fixed hint table by ordered rules over read-only game state, shown as narrator lines and spoken by the existing ghost voice (spec 6). The original HELP, INFO and the engine's own hint system stay exactly as in 1976. No AI writes the hints; the AI parser only recognizes that the player is asking.

Facts from the code that shape this spec (read, not run):

- Typed or spoken lines reach `GameController.processLine`, which sends non-classic text to the AI resolver before `deliver`; `deliver` runs the input transformers and gates, and a gate `deflect` result with `count: false` shows narrator lines without calling `step` (spec 5). The hint answer therefore needs no controller change: both the "ghost" prefix and the AI result turn into the text `GHOST`, which a Haunted-mode gate answers.
- The wire format is `{"command": "<string>"}`; a rejected output becomes HTTP 422 `no_command`; the system prompt has a `NOCOMMAND` token and 8 few-shot examples. The smallest change is a second reserved token, `GHOST`, handled before `validateCommand` on both sides; the request and response shapes stay the same.
- No "20/20 mapping accuracy" evaluation exists in the repository (no script, fixture or test measures it), so it cannot be re-run here. This spec adds a small live evaluation script for the owner to run against the deployed endpoint and keeps the prompt change minimal. Not verified: the accuracy before or after the change; Workers AI cannot be called from the tests.

## Glossary

- **Ghost_Ask**: a line that asks the ghost for help: starts with the word "ghost", is one of a short list of exact stuck/help phrases, or is classified as ask-ghost by the AI parser.
- **Hint_Table**: the ordered list of hint rules and their lines in `src/haunt`.
- **Hint_View**: a small read-only summary of `GameState` used by the rules.

## Requirements

### Requirement 1: Asking

1. In Haunted mode, at the command prompt, a line that begins with the word "ghost" (any case, optional punctuation, e.g. "ghost, where do I go?", "ghost help", "Ghost.") SHALL be a Ghost_Ask, handled client-side with no AI call.
2. A short fixed list of exact phrases ("I'm stuck", "what now", "what do I do", "where do I go", "help me") SHALL also be a Ghost_Ask client-side, so asking works when the AI is unavailable. None of them may be a classic command.
3. Other help or stuck questions SHALL be recognized by the AI parser as a new ask-ghost result: the Worker prompt gets one rule and two examples, the Worker answers with the reserved command `GHOST`, and the client maps that to a Ghost_Ask. Request and response shapes do not change. Normal command mapping SHALL not regress (the existing prompt examples and the vocabulary list stay; the owner re-checks accuracy with the evaluation script of Requirement 6).
4. Plain `HELP`, `INFO` and every other classic command, and the engine's hint questions, SHALL behave exactly as in 1976 (they never become Ghost_Asks). In 1976 mode "ghost ..." and the AI route do nothing new.
5. At yes/no or file-name prompts, a Ghost_Ask is not answered with a hint (the existing yes/no nudge applies).

### Requirement 2: Answering

1. The answer SHALL come from the Hint_Table: ordered rules over a read-only Hint_View (location or region, inventory, key flags such as lamp lit, grate unlocked, bird caught, snake gone, dragon, troll, pirate chest, lamp running low, treasure carried). The first matching rule wins; a generic fallback rule always matches last.
2. Each rule has 2 or 3 sarcastic variants, rotated deterministically (asking twice in the same situation gives the next variant). Hints are nudges, not full solutions. There are about 40 to 60 hint lines in total, each in the narrator's voice under the same rules as spec 5 lines (plain ASCII, at most 160 characters, clean humor, no brands, clueless about the modern world).
3. Asking SHALL NOT cost points, SHALL NOT call `step`, and SHALL NOT read or change the engine RNG, the state object, the once-per-game XYZZY deflection count or the autosave counters. The answer is shown as narrator lines after the echoed question.
4. The hint answer is computed from the current state only; it never reads input text beyond recognizing the ask.

### Requirement 3: Voice

1. Hint lines SHALL be part of the voice line list so `npm run gen:voice` pre-generates them, and they play through the existing ghost voice with no new playback code.
2. The total audio limit rises from 3 MB to 4 MB (script warning, test and README).
3. Until the owner re-runs `npm run gen:voice`, hint lines without audio are shown as text only; the manifest sync test reports the missing lines.

### Requirement 4: Isolation

1. 1976 mode SHALL load no hint code, make no new request, and its start script SHALL NOT grow (all new code is in the haunt, parser and parse-api chunks; `check:dist` gets a hint-table marker check).
2. Any failure in the hint code SHALL leave the game playable: the line is then handled as if the ghost did not exist (engine reply).

### Requirement 5: Testing

1. Tests SHALL cover: Ghost_Ask recognition (prefix, exact phrases, non-asks like "HELP", "ghostly" and normal commands), rule ordering and first-match-wins on constructed and real engine states, variant rotation, fallback, line limits and uniqueness, no engine state/RNG/score change (state identical before and after, `step` not called), AI sentinel handling on the client and the Worker (including 422 and non-regression of normal commands), 1976 isolation, and the voice line list including the hint lines.

### Requirement 6: Evaluation script

1. `npm run eval:parser -- <base-url>` SHALL send a fixed list of about 20 command sentences, about 8 ask-ghost sentences and about 6 negatives to the `/api/parse` endpoint (paced under the rate limit) and print per-sentence results and the totals. It is run by the owner against a deployed or local Pages dev server; tests never call it.
