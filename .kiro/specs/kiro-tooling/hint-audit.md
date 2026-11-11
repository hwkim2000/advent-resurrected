# Ghost hint audit

Route: upstream win430.log (seed 1318612053), haunted mode, hints from `ask_ghost`.

"Before" is the first audit (live MCP). "After" is the same route replayed after the hint changes; see "How the after column was produced".

| Checkpoint | Location | Rule | Hint | Verdict | After: rule | After: hint | After: verdict |
|---|---|---|---|---|---|---|---|
| 1a. Outside | In front of building (turn 2, after visiting inside) | start | "Start with the little brick building. Houses in 1976 held useful things like lamps and snacks and keys. Mine held a fan and a regret." | good (points at the building; joke is flavor) | start | unchanged | good |
| 1b. Building | Inside building (turn 1) | building | "Take what you can carry. This is the original supply closet. Light, keys, a snack, a bottle. You will want more than one of them." | good (lists the items actually present) | building | unchanged | good |
| 0. Title prompt (new game, "Would you like instructions?") | turn 0 | fallback | "I have no idea what you should do. I have been dead since 1977 and my advice is dated. Try looking, then try going somewhere." | generic (prompt is yes/no; hint says look/go, which does not apply) | titlePrompt | "That is a yes or no question. YES gets you the rules, NO gets you the cave. I have waited a long time for you to pick one, so please do." | good |
| 2. Cave entry / deep cave | Bedquilt (turn 20, lamp on, via Y2 / dirty passage) | fallback | "I have no idea what you should do. I have been dead since 1977 and my advice is dated. Try looking, then try going somewhere." | generic (lit lamp, inside the cave, no rule matches; fallback is not wrong but gives no direction) | fallback | unchanged (not in scope of this pass) | generic |
| 3. Hall of Mists | Hall of Mists (turn 72, holding lamp, cage with bird, nugget, keys, food) | fallback | "I have no idea what you should do. I have been dead since 1977 and my advice is dated. Try looking, then try going somewhere." | generic (a notable landmark with no rule; repeats the same fallback line as the title prompt and Bedquilt) | mists | "Hall of Mists. Stairs up, a gap to the west, a low room south. Some bridges get built by waving at the right object." | good |
| 4a. Ogre chamber (south of maze, dwarf + ogre present) | Large chamber with passages west and north (turn 109) | fallback | "I have no idea what you should do. I have been dead since 1977 and my advice is dated. Try looking, then try going somewhere." | generic (a threatening dwarf and a blocking ogre are on screen; no danger or combat rule fires) | danger | "Dwarves throw knives and ogres block doors. Your problems sometimes solve each other, if you pick the right target at the right moment." | good (nudges toward the dwarf-and-ogre trick without naming it) |
| 4b. Maze (twisty, "all different") | Maze of twisty little passages, all different (turn 124) | maze | "Maze. All alike. Leave something lying in each room so you can tell them apart. Clutter is a navigation system, as every messy desk knows." | good (correct classic advice: drop items; minor nit: this room says "all different", the hint says "All alike") | maze | "Maze. Whatever the room claims, you will not tell them apart by looking. Leave something lying in each one. Clutter is a navigation system." | good (no longer contradicts the room text; checked in both an "all different" room, turn 116, and an "all alike" room, turn 131) |
| 5. Plover Room (fresh game, via PLUGH then PLOVER, turn 3) | Plover Room, emerald on the floor, lamp not yet taken | fallback | "I have no idea what you should do. I have been dead since 1977 and my advice is dated. Try looking, then try going somewhere." | generic (emerald is in plain sight and the alcove squeeze is the classic puzzle; no Plover rule fires, so the fallback is a missed opportunity) | plover | "Green glow, an egg-sized emerald, and a tunnel west that hates luggage. Work out what to leave behind before you try the squeeze." | good |
| 6. Outside, late (carrying treasure above ground) | Cliff in the forest (turn 173, carrying rug, emerald, bottle, appendage) | treasureAbove | "Loot in your pockets above ground. Loot counts when it is safe at home, not on you. The well house is the traditional bank." | good (accurate scoring advice; the only moment treasure was held outdoors) | treasureAbove | unchanged | good |
| 7. Late game, mid FEE FIE FOE FOO | Junction with warm walls (turn 289, carrying bear, chain, magic words fee/fie/foe said) | fallback | "I have no idea what you should do. I have been dead since 1977 and my advice is dated. Try looking, then try going somewhere." | generic (the next word, FOO, is the whole puzzle; a "say the last word" nudge would be ideal) | foeSaid | "FEE, FIE, FOE. That poem has four lines and I am not saying the last one for you. Finish the verse." | good |
| 8a. Endgame, repository SW end | SW end of repository (turn 344, score 391, caveClosing, lamp off) | closing | "The cave is closing and I cannot tell you everything. The ending has some showmanship in it, and you are standing in the wings." | generic (correct phase and in-character, but not actionable: nothing about the rod or BLAST) | repoRod | "One rod in here is dynamite wearing a disguise. Carry it a good way along the mirror, then walk back without it." | good |
| 8b. Endgame, rod set at NE end, one step from BLAST | SW end of repository (turn 348) | closing | "The cave is closing and I cannot tell you everything. The ending has some showmanship in it, and you are standing in the wings." | generic (identical to 8a; the rule does not react to the rod being placed, so the hint never gets more specific) | repoBlast | "Rod set down, and you are a safe distance away. The word you want is short, loud, and rhymes with last. Do try to enjoy the ending." | good |

## Summary (before)

- 12 checkpoints: 4 good, 8 generic, 0 misleading.
  - good: 1a start, 1b building, 4b maze, 6 treasureAbove
  - generic: 0 title prompt, 2 Bedquilt, 3 Hall of Mists, 4a ogre chamber, 5 Plover Room, 7 FEE FIE FOE, 8a, 8b closing
- The `fallback` rule fired on 6 of 12 checkpoints, including every cave region (Bedquilt, Hall of Mists, Plover Room, ogre chamber, FOE junction). It reads as filler, and its "look, then go somewhere" advice is wrong on the yes/no title prompt.

## Summary (after)

- 11 of 12 checkpoints good; the one remaining generic checkpoint is 2 (Bedquilt), which was not in this pass. 0 misleading.
- `fallback` now fires at 1 of 12 checkpoints.
- 15 new or reworded lines (cap was 15): 7 new rules x 2 lines (`titlePrompt`, `plover`, `mists`, `danger`, `foeSaid`, `repoRod`, `repoBlast`) plus 1 reworded `maze` line. The old maze line is dropped from the voice list.
- Rule order: `titlePrompt` first; `repoBlast` and `repoRod` before `closing`; `danger` and `foeSaid` after `lampLow`; `plover` and `mists` before `bird`.
- `titlePrompt` is only reachable through `ask_ghost` (and anything else that calls `selectHintRule` at the opening prompt). In the game UI the ghost gate only answers at the command prompt, so a player asking for a hint at "Would you like instructions?" still gets the existing YES/NO nudge.

## The three oddities

1. Maze hint said "all alike" in an "all different" room: our text, fixed. The hint now says "Whatever the room claims, you will not tell them apart by looking", and a test asserts the maze pool never says "all alike". Both maze flavours were checked.
2. `get_state` seed after `seed N`: our bug in the MCP session (`tools/advent-mcp/session.ts`). The session reported only the `new_game` seed. The engine did apply the in-game seed (the replay is reproducible). `get_state.seed` now reports the seed of the latest `new_game` or in-game `SEED n` command (parsed like the engine: strtol, low 32 bits, only at the command prompt). Engine untouched.
3. `dragonDead` staying false: our bug in the MCP session, not the engine. The flag compared the dragon's state to `DRAGON_DEAD` only, but `DRINK BLOOD` (in the upstream route) moves it to `DRAGON_BLOODLESS` (C: `drink` in actions.c). The flag is now true for both states. Engine untouched.

## How the after column was produced

- The MCP server process attached to this session was started before the code change and still ran the old hint table (a fresh `new_game` + `ask_ghost` still returned `start`). I cannot restart it from here, so the after hints come from the same `GameSession` class the MCP server wraps, replaying the same `win430.log` route with seed 1 / mode haunted and calling `askGhost()` at each checkpoint. Re-run `ask_ghost` through MCP after restarting the `advent` server to confirm over stdio.
- Checkpoint turns match the original audit except 4b, sampled at turns 116 and 131 so that no dwarf was present.

## Voice audio: regenerated

- `npm run gen:voice` generated the 15 new lines and removed 1 stale file (114 files, 3.85 MB, under the 4 MB cap). The voice manifest sync test passes.
