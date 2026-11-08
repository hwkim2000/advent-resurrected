# Requirements Document

## Introduction

This spec covers the Game_Engine for ADVENT: Resurrected: a faithful TypeScript port of the Open Adventure engine (BSD-2, C sources under `reference/open-adventure/`), driven by game data generated at build time from `original/adventure.yaml`. The engine is pure and deterministic: Game_State, a Command and an injected RNG produce a new Game_State and structured output. It contains no DOM, network or timer code and imports nothing from the `ui`, `haunt`, `parser` (AI), or `voice` layers.

In scope: the YAML-to-TypeScript data generator, the exact LCG RNG port, Game_State, the classic two-word Parser, all actions, dwarf and pirate movement, the lamp, hints, scoring up to 430 points, death and reincarnation, JSON save/restore, structured Output_Events, and a Node CLI runner.

Out of scope: UI, voice input and output, the AI parser, and the haunted layer. The engine only exposes Output_Events so those layers can hook in later.

The feature is done when every upstream `reference/open-adventure/tests/*.log` outside the documented Skip_List replays through the engine and matches its `.chk` file, `win430.log` reaches 430 points, and the fast-check properties pass.

## Glossary

- **Game_Engine**: The pure TypeScript module in `src/engine/` that ports Open Adventure logic.
- **Game_Data**: TypeScript modules in `src/data/` generated from `original/adventure.yaml` (locations, objects, motions, actions, hints, messages, obituaries, classes, turn thresholds, arbitrary messages, travel table).
- **Data_Generator**: The build-time script in `scripts/` that reads `original/adventure.yaml` and emits Game_Data.
- **Game_State**: The complete serializable state of one game, equivalent to the C `game` struct (including the RNG state `lcg_x`, turn count, score-related counters, object and dwarf state, lamp life, hint state, and death count).
- **Command**: One line of player input text, passed to the Game_Engine as a string.
- **Parser**: The classic Open Adventure two-word parser inside the Game_Engine (port of `get_command_input`, `tokenize`/`get_vocab_metadata` and related logic in `main.c` and `misc.c`).
- **RNG**: The Open Adventure linear congruential generator ported from `misc.c` (`set_seed`, `get_next_lcg_value`, `randrange`), using the same constants and call order.
- **Output_Event**: A structured, typed record emitted by the Game_Engine describing something that happened (text, room entered, lamp level changed, death, magic word used, score change, and similar), with the original game text carried unmodified.
- **Step_Result**: The value returned by one engine step: the new Game_State plus an ordered list of Output_Events.
- **Magic_Word**: One of XYZZY, PLUGH, PLOVER, or FEE FIE FOE FOO as defined by the Open Adventure data.
- **Upstream_Log**: A `.log` input script in `reference/open-adventure/tests/`.
- **Upstream_Check**: The `.chk` file expected output matching an Upstream_Log.
- **Skip_List**: The documented list of Upstream_Logs that depend on the C binary `.adv` save format or the `cheat` tool, each with a one-line reason.
- **Fidelity_Suite**: The Vitest suite that replays every Upstream_Log and compares the rendered output to its Upstream_Check.
- **Replay_Harness**: Test-support code that feeds an Upstream_Log through the Game_Engine using the seed and options the upstream harness uses (`tests/Makefile`, including the `#options:` line of a log) and renders Output_Events to text.
- **CLI_Runner**: A Node command-line program that lets a person play the Game_Engine in a terminal.
- **Save_Document**: The JSON representation of a Game_State.

## Requirements

### Requirement 1: Generate Game Data from the YAML

**User Story:** As a developer, I want game data generated from `original/adventure.yaml`, so that the engine uses the original content without hand-editing it.

#### Acceptance Criteria

1. WHEN the Data_Generator is run, THE Data_Generator SHALL read `original/adventure.yaml` and write Game_Data files under `src/data/`, and SHALL complete within 30 seconds on a machine that can run the project's test suite.
2. THE Data_Generator SHALL write, as the first lines of every generated file, a header comment stating that the file is generated, that it must not be hand-edited, and the exact command that regenerates it.
3. WHEN the Data_Generator is run, THE Data_Generator SHALL leave every file under `original/` and `reference/` unmodified, so that the byte content and size of each file are identical before and after the run.
4. WHEN the Data_Generator is run twice on the same `original/adventure.yaml`, THE Data_Generator SHALL produce byte-identical output files both times, with no timestamps, absolute paths or other run-dependent values in the output.
5. THE Data_Generator SHALL preserve every message, location description, object description (including every state-dependent description) and obituary string from the YAML character for character, including whitespace, punctuation, case and line breaks, after applying the C string-escape conversion that `make_dungeon.py` output undergoes when compiled (a literal backslash followed by `n` or `t` in the YAML text becomes a newline or tab character), so that a string comparison of each generated string with its escape-converted YAML source passes with zero differences, and the five YAML strings that contain such literal escapes are listed explicitly in the test.
6. IF `original/adventure.yaml` is missing, unreadable, or not valid YAML, or lacks a required top-level section, THEN THE Data_Generator SHALL exit with a non-zero status, print an error message naming the file and describing the problem, and leave any previously generated files under `src/data/` unmodified.
7. THE Game_Data SHALL contain exactly the same number of locations, objects, motions, actions, hints, classes, obituaries and arbitrary messages as the tables generated by `make_dungeon.py` from the same YAML, and each entry SHALL appear in the same order and with the same index as in those tables.
8. THE Game_Engine SHALL obtain all game content (messages, descriptions, vocabulary, map connections and scoring text) by importing Game_Data, and the engine source SHALL contain no string literal copied from the YAML content.

### Requirement 2: Exact RNG Port

**User Story:** As a developer, I want the exact Open Adventure RNG, so that seeded runs reproduce upstream behavior.

#### Acceptance Criteria

1. THE RNG SHALL implement `set_seed`, `get_next_lcg_value` and `randrange` with the constants LCG_A = 1093, LCG_C = 221587 and LCG_M = 1048576, and with the formulas of `misc.c`, so that for the same seed and call sequence every returned value equals the value the C source returns.
2. THE RNG SHALL compute all arithmetic with 32-bit-safe integer math that matches C `int32_t` overflow and truncating-modulo behavior, including negative seed values and the product `range * get_next_lcg_value()` in `randrange`.
3. THE Game_Engine SHALL receive its RNG seed through injection and SHALL contain no call to `Math.random`, `Date`, or any other source of nondeterminism.
4. THE Game_Engine SHALL invoke the RNG in the same order and the same number of times as the C source for the same sequence of Commands, verified by comparing the sequence of RNG outputs for each replayed upstream test log.
5. WHEN `set_seed` is called with a seed value, THE RNG SHALL set `lcg_x` to `seed % LCG_M`, add LCG_M if the result is negative so that `lcg_x` is in the range 0 to 1048575 inclusive, and then perform the same follow-up generation of the magic word `zzword` that `set_seed` in `misc.c` performs.
6. FOR ALL seed values in the signed 32-bit range and all call sequences, THE RNG SHALL return `randrange(n)` values in the range 0 to n-1 inclusive for every n from 1 to 2048, the largest range for which the C `int32_t` product `n * get_next_lcg_value()` cannot overflow; for n above 2048 THE RNG SHALL reproduce the C overflow result, and every call in the Game_Engine SHALL use n of 1000 or less.
7. FOR ALL Game_States, THE Game_Engine SHALL produce an identical Step_Result when given an identical Game_State and Command (determinism property).

### Requirement 3: Game State and Step Function

**User Story:** As a developer, I want a pure step function over an explicit state, so that other layers can drive and observe the game without side effects.

#### Acceptance Criteria

1. THE Game_Engine SHALL expose a function that accepts an integer seed and an options object and returns a new Game_State, such that two calls with the same seed and options return Game_States that are deeply equal.
2. WHEN a Command is submitted, THE Game_Engine SHALL return a Step_Result containing a new Game_State and an ordered list of zero or more Output_Events, in the order the corresponding Open Adventure C code would print them.
3. WHEN a step is executed, THE Game_Engine SHALL leave the input Game_State unmodified, such that a deep comparison of the input Game_State before and after the step shows no differences.
4. THE Game_Engine SHALL import no module from `src/ui`, `src/haunt`, `src/parser`, or `src/voice`, and SHALL reference no DOM, network, or timer API.
5. THE Game_State SHALL contain every field needed to resume play, including the RNG state, turn counters, object locations and states, dwarf and pirate state, lamp life, hint counters, death count, and closing and panic flags, such that replaying the same Command sequence from a serialized and deserialized copy of a Game_State produces a Step_Result deeply equal to the one produced from the original.
6. WHEN a new Game_State is created, THE Game_Engine SHALL initialize every field with the same starting value as `initialise` in `init.c`, including the same sequence of RNG calls made during initialization.
7. FOR ALL Command strings, including the empty string, strings of up to 100,000 characters, and strings containing non-ASCII characters, THE Game_Engine SHALL return a Step_Result without throwing.
8. IF a Command string is not recognized by the classic parser, THEN THE Game_Engine SHALL return a Step_Result whose Output_Events contain the original game's unrecognized-input response and whose Game_State is deeply equal to the input Game_State except for state changes that the C source makes on that path (such as turn counters).

### Requirement 4: Classic Two-Word Parser

**User Story:** As a player, I want the classic two-word parser, so that typed input behaves exactly as in the original game.

#### Acceptance Criteria

1. WHEN a Command contains one or two words, THE Parser SHALL match each word to a vocabulary entry by comparing only the first TOKLEN characters (as defined in the C source), ignoring letter case, so that a word longer than TOKLEN characters matches any vocabulary entry sharing its first TOKLEN characters.
2. WHEN a Command contains more than two words, THE Parser SHALL produce the same response and the same resulting game state as the C source (`tokenize` in `misc.c`).
3. IF the first word of a Command is not in the vocabulary, THEN THE Game_Engine SHALL output the same unknown-word response as the C source, including the player's original word as typed, and SHALL leave game state unchanged apart from any turn or counter effects the C source applies.
4. WHEN a verb requires an object and none was given, THE Game_Engine SHALL output the same "what do you want to do with it" prompt as the C source, with the verb's first letter capitalized as the C source does.
5. WHEN a Command is the empty string, THE Game_Engine SHALL silently re-prompt, producing no text, consuming no turn and leaving the Game_State unchanged. WHEN a Command is non-empty and contains only spaces and tabs, THE Game_Engine SHALL treat it as a real null move that costs one turn, as the C source does, and SHALL NOT change the player's location or score.
6. WHEN a Command line begins with `#` as its first character and the Game_Engine is reading input through the equivalent of `get_input` (the novice question, the command prompt, and yes/no questions), THE Game_Engine SHALL skip that line without passing it to the Parser and without producing output, as `get_input` in `misc.c` does; WHEN the Game_Engine is reading a save-file name, THE Game_Engine SHALL take such a line as the file name, as the C source does.
7. THE Parser SHALL apply exact classic matching (case-insensitive, truncated to TOKLEN characters) to typed input and SHALL NOT apply fuzzy, phonetic, alias, or edit-distance matching.
8. WHEN a Magic_Word is entered, THE Game_Engine SHALL emit exactly one magic-word-used Output_Event identifying that word, in addition to the original game text, and SHALL leave the original game text identical to the C source output.
9. IF a Command contains a second word that is not in the vocabulary, THEN THE Game_Engine SHALL respond as the C source does for that case, and the Replay_Harness SHALL match the upstream `.chk` output for that response.
### Requirement 5: Movement and Travel

**User Story:** As a player, I want to move through the full cave, so that I can explore every location.

#### Acceptance Criteria

1. WHEN a motion Command is issued, THE Game_Engine SHALL select the destination by evaluating the travel entries for the current location in their original table order and choosing the first entry whose verb matches and whose condition is satisfied, as `playermove` in `main.c` does.
2. WHEN a travel entry has a probability condition, THE Game_Engine SHALL decide it by calling the injected RNG the same number of times and in the same order as the C source, so that a run with the same seed produces the same destination as the C source in 100% of the upstream test logs.
3. WHEN the player enters a location, THE Game_Engine SHALL emit one room-entered Output_Event identifying the location, followed by the location description text. The description SHALL be the full text on the first visit and in full-description mode, and SHALL be the brief text on a later visit in brief mode, exactly as the C source selects it.
4. WHEN the player issues a movement that has special handling (forced moves, the twisty mazes, the plover room, the dragon and troll crossings, the bridge, the pit and the bear), THE Game_Engine SHALL produce output text and state changes (location, inventory, score-relevant flags and object states) identical to the C source for that movement.
5. IF a motion is not valid from the current location, THEN THE Game_Engine SHALL output the same refusal text as the C source, leave the player's location and all other game state unchanged except for state the C source also changes, and not throw an error.
6. WHEN the player issues a FEE, FIE, FOE or FOO word, THE Game_Engine SHALL update the magic word sequence state, and SHALL output the same text and apply the same state changes as the C source, including the response to an out-of-order word and the effect of a complete sequence.
7. WHEN a movement is issued while the player is carrying an object or is subject to a condition that the C source checks for travel (for example the lamp being off in a dark location, or the bear following), THE Game_Engine SHALL apply that check in the same order as the C source and output the same text.

### Requirement 6: Actions and Objects

**User Story:** As a player, I want every original verb to work on every original object, so that all puzzles are solvable.

#### Acceptance Criteria

1. THE Game_Engine SHALL implement every action handler function defined in `actions.c` (reference commit e6160529e70a8c7a06b9a5f190d69aa35c4c62f5), with identical preconditions, identical state changes, and byte-identical output text for every input accepted by the C handler.
2. WHEN the player takes, drops, throws, or carries an object, THE Game_Engine SHALL enforce the same carry limit (the maximum number of objects held at once), bird, cage, rod, and vase rules as the C source, and SHALL leave the game state unchanged when the C source refuses the action.
3. WHEN the player attacks the dragon without a weapon in hand, THE Game_Engine SHALL print the original "bare hands" exchange, SHALL accept a "yes" answer to the follow-up question as the C source does, and SHALL apply the same dragon-dead state change, including the same object and player location updates.
4. WHEN the player performs an action involving the bear, snake, troll, bird, clam, oyster, mirror, plant, door, grate, or chain, THE Game_Engine SHALL produce the same output text and the same resulting object states, properties, and locations as the C source for every state combination exercised by the upstream `.log` tests.
5. WHEN the player reads, feeds, pours, waves, rubs, lights, or extinguishes an object, THE Game_Engine SHALL apply the same state transition and print the same output text as the C source.
6. IF an action is not permitted in the current state, THEN THE Game_Engine SHALL print the same refusal message as the C source and SHALL leave the game state unchanged except for any changes the C source makes on that path (such as the turn counter or a random-number draw).
7. WHEN the player issues a built-in command (SEED, SCORE, QUIT, SAVE, RESUME, BRIEF, LOOK, INVENTORY, or SUSPEND), THE Game_Engine SHALL behave as `actions.c` and `main.c` specify, including the same prompts, confirmation handling, and output text.
8. IF the player enters an input that matches no verb, no object, or an invalid verb-object combination, THEN THE Game_Engine SHALL print the same "don't understand" or refusal message as the C source and SHALL NOT throw an exception.

### Requirement 7: Dwarves and Pirate

**User Story:** As a player, I want hostile dwarves and the pirate to behave as in the original, so that the game is as dangerous and as funny as before.

#### Acceptance Criteria

1. WHEN the player first reaches a location for which the C source's `INDEEP` test is true (the Hall of Mists or deeper), THE Game_Engine SHALL activate the dwarves as `dwarfmove` in `main.c` does, consuming RNG values in the same count and order as the C source, and placing dwarves at the same locations as the upstream engine for the same seed.
2. WHILE the player is in the deeper cave and dwarves are active, WHEN the player completes a turn, THE Game_Engine SHALL move each dwarf and the pirate using the movement and tracking rules of `dwarfmove` in `main.c`, so that every dwarf and pirate location after each turn equals the upstream value for the same seed and command sequence.
3. WHEN a dwarf attacks the player, THE Game_Engine SHALL resolve the knife throw and the hit chance using the RNG calls, thresholds, and call order of the C source, so that for the same seed the outcome (miss, hit, or death) and the count of dwarves that have thrown knives match upstream.
4. WHEN the player throws an axe at a dwarf in the same location, THE Game_Engine SHALL resolve the throw as the C source does, producing the same kill or miss outcome for the same seed, leaving the axe at the same location as upstream, and removing a killed dwarf from play.
5. IF the player throws an axe and no dwarf is present at the player's location, THEN THE Game_Engine SHALL produce the same result and text as the C source for that case and leave the game state otherwise unchanged except as the C source specifies.
6. WHEN the pirate is active and the player carries treasure at the pirate's encounter, THE Game_Engine SHALL steal the treasure items the C source specifies, remove them from the player's inventory, and place them in the pirate's chest location so that the chest contents and the player's inventory match upstream for the same seed.
7. IF the pirate is active and the player carries no treasure at the encounter, THEN THE Game_Engine SHALL apply the C source's no-treasure behavior without removing any item from the player's inventory.
8. THE Game_Engine SHALL emit every dwarf and pirate encounter message with text byte-identical to the corresponding `adventure.yaml` text, with no added, removed, or reordered characters.
9. THE Game_Engine SHALL produce output identical to the matching `.chk` file for every upstream test in `reference/open-adventure/tests/` that exercises dwarves, the axe, or the pirate, when replayed with the seed and options of the upstream test harness.

### Requirement 8: Lamp and Light

**User Story:** As a player, I want the lamp battery to drain and warn me as in the original, so that exploration is time-limited.

#### Acceptance Criteria

1. WHILE the lamp is lit, THE Game_Engine SHALL decrement `game.limit` (the lamp life counter) by exactly 1 once per player turn, and SHALL NOT decrement it while the lamp is off, as `lampcheck` in `main.c` does. The counter starts at GAMELIMIT (330).
2. WHEN lamp life is WARNTIME (30) or fewer after a turn's decrement, the lamp is present, the battery warning has not yet been issued, and the fresh batteries are not present with the lamp, THE Game_Engine SHALL print the warning message exactly once, selected as in `lampcheck` (missing-batteries message, lamp-dim message, or get-batteries message), and SHALL then mark the warning as issued.
3. WHEN lamp life reaches exactly 0, THE Game_Engine SHALL set lamp life to -1 and put the lamp in the dark (off) state. If the lamp is present, it SHALL also print the lamp-out message. The player SHALL remain able to continue playing.
4. WHEN lamp life changes, THE Game_Engine SHALL emit one lamp-level Output_Event carrying the remaining life and the initial life (GAMELIMIT), and SHALL emit no more than one such event per turn.
5. WHILE the player is in a dark location (not a forced-motion location) and the dark flag was set at the start of the player's previous move, THE Game_Engine SHALL cause the pit fall with a probability of PIT_KILL_PROB (35) percent per turn, using the injected RNG as the C source does. The pit-fall message SHALL be printed and the death sequence SHALL begin.
6. WHILE the player is in a dark location (not a forced-motion location), THE Game_Engine SHALL print the pitch-dark message in place of the location description, as in the C source.
7. WHEN the player is in the same location as the fresh batteries and the lamp, and lamp life is WARNTIME or fewer after a turn's decrement, THE Game_Engine SHALL print the replace-batteries message, mark the batteries as dead, add BATTERYLIFE to lamp life, and clear the warning-issued flag.
8. IF lamp life is already -1 (lamp has burned out), THEN THE Game_Engine SHALL leave the lamp off, SHALL NOT decrement lamp life further, and SHALL still allow play to continue until the game-clock rules in the C source end the game.
### Requirement 9: Hints

**User Story:** As a player, I want the original hint system, so that I can get help at a point cost.

#### Acceptance Criteria

1. WHILE the player is at a location whose condition bits make a hint eligible and the hint is unused, THE Game_Engine SHALL increment that hint's turn counter by 1 on each turn, as `checkhints` in `main.c` does. WHEN the player moves to a location that does not make that hint eligible, THE Game_Engine SHALL reset that hint's counter to 0 as the C source does.
2. WHEN a hint's turn counter reaches or exceeds that hint's turn threshold AND that hint's special condition from the original game is met, THE Game_Engine SHALL print the original question text for that hint and wait for a yes/no answer.
3. IF a hint's turn counter reaches its threshold but its special condition is not met, THEN THE Game_Engine SHALL print no hint offer and SHALL apply the counter handling the C source specifies for that hint.
4. WHEN the player answers yes to a hint question, THE Game_Engine SHALL print the original hint-cost message stating the hint's point cost, then ask the original confirmation question and wait for a yes/no answer.
5. WHEN the player confirms the hint, THE Game_Engine SHALL print the original hint text, mark the hint as used, and subtract that hint's point cost from the score exactly once, however many times the score is computed afterward. WHEN a hint is marked used, THE Game_Engine SHALL NOT offer it again.
6. WHEN the player confirms a hint AND the remaining limit is above WARNTIME, THE Game_Engine SHALL extend the remaining limit by WARNTIME multiplied by the hint's point cost, as in `checkhints`.
7. WHEN the player answers no to the hint question or to the confirmation question, THE Game_Engine SHALL print the original acknowledgment text, leave the score unchanged, leave the hint unused, and reset that hint's counter to 0 as the C source does.
8. THE Game_Engine SHALL store each hint's turn counter and used flag in Game_State so that serialization followed by restoration yields identical counters, used flags, and subsequent hint-offer timing.

### Requirement 10: Scoring

**User Story:** As a player, I want the original scoring, so that I can reach the maximum of 430 points.

#### Acceptance Criteria

1. THE Game_Engine SHALL compute the score using the same formula and constants as `score` in `score.c`, including treasures, deaths, hints, saves, turns, closing bonuses, and class rankings, so that for any Game_State the computed integer equals the value the C implementation computes for the equivalent state.
2. WHEN the player requests the score or the game ends, THE Game_Engine SHALL print the score line, the maximum possible score, and the class rank message with text identical, character for character, to the C source's output for the same state.
3. FOR ALL reachable Game_States, THE Game_Engine SHALL compute a score that is an integer no greater than 430, and FOR ALL Game_States reached from a new game by 100 or fewer Commands, THE Game_Engine SHALL compute a score that is an integer in the range 0 to 430 inclusive (the C `score` function does not clamp, so longer sequences with many hints, turn penalties and saves are not bounded below by 0).
4. WHEN the score computed after a command differs from the score computed before that command, THE Game_Engine SHALL emit exactly one score Output_Event containing the new integer score, and SHALL emit no score Output_Event for a command that leaves the score unchanged.
5. WHEN `reference/open-adventure/tests/win430.log` is replayed from a new game (its own in-log `seed` command sets the seed), THE Game_Engine SHALL reach the game-over state, SHALL report a final score of exactly 430, and SHALL print the top class rank message.
6. WHEN the score is computed, THE Game_Engine SHALL leave the Game_State unchanged, so that computing it twice in succession on the same state returns the same value.
7. IF the player requests the score before any scoring event has occurred, THEN THE Game_Engine SHALL print the score computed for that state, which is the C source's initial value, rather than an error or an empty result.

### Requirement 11: Death and Reincarnation

**User Story:** As a player, I want the original death and reincarnation scene, so that the game keeps its best-known moment.

#### Acceptance Criteria

1. WHEN the player dies, THE Game_Engine SHALL emit a death Output_Event identifying the cause and the death count (an integer from 1 to the maximum number of deaths), followed by the original obituary text for that death count.
2. WHEN the player dies and the death count is below the maximum number of deaths defined by the original game data, THE Game_Engine SHALL emit the original reincarnation prompt for that death count and wait for a yes or no Command.
3. IF a Command other than a recognized yes or no is submitted while the reincarnation prompt is pending, THEN THE Game_Engine SHALL re-ask the question using the behavior of `yes_or_no` in `misc.c`, keep the pending prompt and the rest of the state unchanged, and not count the Command as a game turn.
4. WHEN the player accepts reincarnation, THE Game_Engine SHALL restore the player and objects exactly as `croak` in `main.c` does (including dropped-object placement, lamp state, and location reset) and SHALL consume RNG values in the same call order as `croak`, so that a seeded run produces output identical to the matching upstream `.chk` file.
5. WHEN the player declines reincarnation, or WHEN the death count reaches the maximum number of deaths, THE Game_Engine SHALL end the game with the original message and the final score computed by `score.c`, without offering reincarnation.
6. IF the player dies while the cave is closing or closed, THEN THE Game_Engine SHALL end the game with the original closing-death message and SHALL NOT offer reincarnation.
7. WHEN the game ends, THE Game_Engine SHALL emit a game-over Output_Event containing the final score (an integer from 0 to 430) and the original score class (rank) text.
8. IF a Command is submitted after the game has ended, THEN THE Game_Engine SHALL return a Step_Result in which the state is deep-equal to the state before the Command, no RNG value is consumed, and the output contains exactly one Output_Event indicating the game is over.

### Requirement 12: Closing and End Game

**User Story:** As a player, I want the cave closing and the endgame, so that I can complete the 430-point game.

#### Acceptance Criteria

1. WHEN the player has located all treasures (the C source's `tally` reaching 0) and the C source's closing conditions are met, THE Game_Engine SHALL start cave closing, set the closing state, and print the original closing announcement text byte-for-byte as produced by the C source.
2. WHILE the cave is closing, THE Game_Engine SHALL decrement the original closing countdowns on the same turns as the C source, SHALL print each original countdown message on the turn the C source prints it, and SHALL move the player and objects to the repository as the C source does when the closing countdown expires.
3. WHILE the cave is closing, THE Game_Engine SHALL apply the C source's closing restrictions, including blocking the exits, the magic words, and the dwarf and pirate behavior that the C source blocks or disables during closing, and SHALL print the original refusal text for each blocked action.
4. WHEN the player triggers the endgame blast in the repository (the blast action implemented by `blast` in `actions.c`), THE Game_Engine SHALL grant the original blast bonus points that the C source's scoring awards for that outcome (including its distinct bonus by the player's position), SHALL print the original ending text, and SHALL set the game state to ended.
5. WHEN the game ends, THE Game_Engine SHALL compute the final score using the C source's scoring rules, SHALL cap the final score at 430, and SHALL report the original rank message corresponding to that score.
6. IF the player attempts any command after the game state is ended, THEN THE Game_Engine SHALL reject the command, leave the game state and score unchanged, and indicate that the game is over.
7. WHEN the same seed and the same command sequence from `reference/open-adventure/tests/` closing-related `.log` scripts are replayed, THE Game_Engine SHALL produce output identical to the matching `.chk` files.

### Requirement 13: Save and Restore as JSON

**User Story:** As a player, I want to save and restore a game, so that I can continue later.

#### Acceptance Criteria

1. THE Game_Engine SHALL provide a function that serializes a Game_State to a Save_Document, where the Save_Document is a single JSON text containing a version identifier and every Game_State field needed to resume play, including the RNG state.
2. WHEN a valid Save_Document is passed to the deserialization function, THE Game_Engine SHALL return the corresponding Game_State.
3. FOR ALL valid Game_States, deserializing the serialization of the Game_State SHALL produce a Game_State deeply equal to the original in every field (round-trip property), and applying the same subsequent command sequence to the original and to the restored Game_State SHALL produce identical output.
4. WHEN the Game_Engine serializes the same Game_State twice, THE Game_Engine SHALL produce Save_Documents that are identical character for character.
5. IF a Save_Document is not valid JSON, has a version identifier that does not match the current version, or has a field value outside the ranges the C source `savefile` checks accept, THEN THE Game_Engine SHALL return a rejection result (not throw an exception), SHALL output the same refusal text as the C source for that failure, and SHALL leave the current Game_State unchanged.
6. WHEN the player enters SAVE or RESUME, THE Game_Engine SHALL perform the write or read through an injected storage interface and SHALL apply the same save-count increment and turn penalties as the C source.
7. THE Game_Engine SHALL perform no file system or browser storage access directly.
8. IF the injected storage interface reports a failure or returns no stored Save_Document during SAVE or RESUME, THEN THE Game_Engine SHALL output a message to the player indicating that the save or restore failed and SHALL leave the current Game_State unchanged.
9. IF the deserialization function receives an arbitrary string, including an empty string, a string longer than 1,000,000 characters, or JSON of the wrong type, THEN THE Game_Engine SHALL return either a valid Game_State or a rejection result without throwing an exception.
### Requirement 14: Structured Output Events

**User Story:** As a developer of later layers, I want typed events instead of only strings, so that voice, haunt and UI layers can hook into game moments.

#### Acceptance Criteria

1. WHEN the Game_Engine processes a command, THE Game_Engine SHALL return the output as an ordered list of Output_Events in the same order the C program would produce the corresponding output, each Output_Event having a discriminating type field whose value is one of the defined Output_Event types.
2. THE Game_Engine SHALL define Output_Event types for at least: text, room-entered, lamp-level, death, reincarnation-offered, magic-word-used, score, prompt, and game-over.
3. WHEN a text Output_Event carries original game text, THE Game_Engine SHALL include that text byte-for-byte identical to the corresponding string in Game_Data, with no added, removed, or reformatted characters.
4. THE Game_Engine SHALL provide a renderer function that converts a list of Output_Events into the exact plain text the C program would print for the same input, character for character, including line breaks.
5. FOR ALL Step_Results, THE renderer function SHALL produce identical text whether the Output_Event list contains zero, some, or all of the non-text event types (room-entered, lamp-level, death, reincarnation-offered, magic-word-used, score, prompt, game-over), except where the C program prints text for that event, in which case that text SHALL be carried by a text Output_Event.
6. THE Game_Engine SHALL include in each Output_Event only data that survives a JSON.stringify followed by JSON.parse with a deep-equal result, excluding functions, undefined values, NaN, Infinity, class instances, and circular references.
7. IF the renderer function receives an empty list of Output_Events, THEN THE renderer function SHALL return an empty string and SHALL NOT throw an error.
8. IF the renderer function receives an Output_Event whose type field is not a defined Output_Event type, THEN THE renderer function SHALL skip that event, contribute no text for it, and SHALL NOT throw an error.

### Requirement 15: Upstream Fidelity Suite

**User Story:** As a maintainer, I want every upstream log replayed against its expected output, so that I can trust the port.

#### Acceptance Criteria

1. WHEN the Fidelity_Suite runs, THE Fidelity_Suite SHALL discover every file with the `.log` extension directly inside `reference/open-adventure/tests/` and create exactly one test case per file, named after the log's base filename.
2. WHEN a test case runs, THE Replay_Harness SHALL feed the Upstream_Log through the Game_Engine one input line at a time, in file order, using the seed and options that the upstream test harness (`tests/Makefile`) uses.
3. WHERE an Upstream_Log contains an `#options:` line, THE Replay_Harness SHALL apply the options on that line in addition to the upstream harness defaults, before feeding the first input line.
4. WHEN a test case finishes feeding the Upstream_Log, THE Fidelity_Suite SHALL compare the rendered output to the matching Upstream_Check and pass only if the two are identical byte for byte, with no whitespace trimming, no line-ending normalization, and no case folding.
5. IF the rendered output differs from the Upstream_Check, THEN THE Fidelity_Suite SHALL fail that test case with a message that names the log and shows the line number and content of the first differing line.
6. THE Fidelity_Suite SHALL pass for every Upstream_Log that has a matching Upstream_Check, except those named in the Skip_List (criterion 11), with no other skipped, excluded, or expected-to-fail test cases.
7. IF an Upstream_Log has no Upstream_Check with the same base filename, THEN THE Fidelity_Suite SHALL fail with a message naming the log and SHALL still run all remaining test cases.
8. IF an Upstream_Log that is not in the Skip_List depends on a file-based fixture (for example `saveresume.adv` written by an earlier log, or a non-save file such as `../main.o`), THEN THE Replay_Harness SHALL supply an equivalent fixture through the injected storage interface, with no access to the real file system from Game_Engine code.
9. THE Fidelity_Suite SHALL read files under `reference/` as raw bytes or with a decoding that preserves LF line endings byte for byte, and SHALL NOT modify, write, or re-checkout any file under `reference/`.
10. THE Fidelity_Suite SHALL run to completion in a single non-watch run started with `vitest --run`.
11. THE Fidelity_Suite SHALL keep a documented Skip_List, in a single file under `tests/`, naming each skipped Upstream_Log with a one-line reason. The Skip_List SHALL contain exactly the Upstream_Logs that depend on the C binary `.adv` save format or on the `cheat` tool: `savetamper`, `cheatresume`, `cheatresume2` (each loads a fixture generated by the `cheat` tool per `tests/Makefile`) and `resumefail2` (loads `resume_badversion.adv`, a C binary save that has no generating rule in `tests/Makefile` and is not present in the repository). `resumefail` SHALL NOT be in the Skip_List, because it loads no fixture and exercises only the failed-open path. The Skip_List therefore contains exactly 4 entries. Each skipped log SHALL be reported by Vitest as skipped (with its reason), not omitted. Every Upstream_Log not in the Skip_List SHALL pass.
12. IF a name in the Skip_List does not match an existing Upstream_Log, or an Upstream_Log in the Skip_List references no `cheat`/binary-save fixture, THEN THE Fidelity_Suite SHALL fail with a message naming the entry, so the Skip_List cannot silently grow.
13. THE save, resume, tampering, version-skew and invalid-file code paths exercised by the Skip_List logs SHALL be covered instead by example-based unit tests that build JSON Save_Documents directly.
14. WHERE no seed is fixed by the upstream harness (upstream seeds from the clock; determinism comes from the in-log `seed N` command), THE Replay_Harness SHALL start every game with one fixed default seed.

### Requirement 16: Property-Based Tests

**User Story:** As a maintainer, I want fast-check properties, so that edge cases beyond the upstream logs are covered.

#### Acceptance Criteria

1. THE test suite SHALL include a fast-check property that the Game_Engine does not throw for arbitrary Command strings (length 0 to 200 characters, including empty, whitespace-only, non-ASCII, and control characters) from a fixed starting Game_State, run for at least 100 generated cases.
2. THE test suite SHALL include a fast-check property that the score reported by the Game_Engine is an integer from 0 to 430 inclusive after every step of arbitrary sequences of 1 to 100 valid vocabulary Commands, run for at least 100 generated sequences.
3. THE test suite SHALL include a fast-check property that, for Game_States reached by arbitrary Command sequences of 0 to 100 Commands, serializing and then deserializing yields a Game_State deeply equal to the original, run for at least 100 generated sequences.
4. THE test suite SHALL include a fast-check property that two runs from the same seed and the same Command sequence of 0 to 100 Commands produce deeply equal Output_Events in the same order, run for at least 100 generated cases.
5. THE test suite SHALL include a fast-check property that `randrange(n)` returns an integer from 0 to n-1 inclusive for arbitrary 32-bit signed integer seeds and arbitrary integers n from 1 to 2048, run for at least 100 generated cases.
6. THE test suite SHALL include a fast-check property that, after any step on a Game_State and Command, the input Game_State is deeply equal to a copy of it taken before the step, run for at least 100 generated cases.
7. IF a fast-check property fails, THEN THE test suite SHALL report the failing test with the shrunk counterexample and the seed used by fast-check, so the failure can be replayed deterministically.

### Requirement 17: Full Walkthrough Test

**User Story:** As a maintainer, I want a scripted full playthrough, so that completability of the 430-point game is proven.

#### Acceptance Criteria

1. THE test suite SHALL include a walkthrough test that replays `reference/open-adventure/tests/win430.log` (read at test time as raw bytes; no new Command list SHALL be authored or copied), using the Replay_Harness and the seed set by the log's own `seed` command, and THE walkthrough test SHALL produce identical output on 2 consecutive runs.
2. WHEN the walkthrough test has submitted the last Command in `win430.log`, THE test suite SHALL assert that the final score equals exactly 430, that the Output_Event stream contains a game-over Output_Event, and that the rendered output equals `win430.chk`.
3. IF the output for any Command differs from `win430.chk`, THEN THE walkthrough test SHALL fail and report the 1-based turn number, the Command text, the expected output, and the actual output for the first differing turn only.
4. IF the walkthrough test ends with a score other than 430, a missing game-over Output_Event, or an unprocessed Command remaining in the log, THEN THE walkthrough test SHALL fail and report the actual final score and the number of Commands processed.
5. WHILE the walkthrough test is running, THE walkthrough test SHALL use only the log's Commands and the injected seeded RNG as inputs, with no reliance on wall-clock time, network access, or non-seeded random values.

### Requirement 18: CLI Runner

**User Story:** As a developer, I want to play the engine in a terminal, so that I can test it manually.

#### Acceptance Criteria

1. WHEN the CLI_Runner is started, THE CLI_Runner SHALL create a new Game_State and print the opening text rendered from Output_Events to standard output before reading any input.
2. WHEN a line is typed, THE CLI_Runner SHALL submit it unchanged as a Command to the Game_Engine and print the rendered output to standard output, with the output text matching the text the Game_Engine produces for that Command.
3. WHERE a seed is passed as a command-line option, THE CLI_Runner SHALL use that seed for the RNG, so that two runs with the same seed and the same input produce identical output.
4. IF the command-line seed is not a valid 32-bit integer, THEN THE CLI_Runner SHALL print an error message indicating the seed is invalid to standard error and exit with a non-zero status before creating a Game_State.
5. WHEN the game ends or input reaches end of file, THE CLI_Runner SHALL exit with status 0.
6. WHEN SAVE or RESUME is used, THE CLI_Runner SHALL implement the injected storage interface by reading and writing files on disk.
7. IF a SAVE or RESUME file operation fails (file missing, unreadable, or unwritable), THEN THE CLI_Runner SHALL report the failure to the Game_Engine through the storage interface, print the resulting game output, keep the current Game_State unchanged, and continue accepting input.
8. IF the Game_Engine reports an internal error, THEN THE CLI_Runner SHALL print the error to standard error and exit with a non-zero status.
9. THE CLI_Runner SHALL reside outside `src/engine/` so that the Game_Engine keeps no Node-specific dependency.

### Requirement 19: Provenance and Licensing

**User Story:** As a maintainer, I want licensing preserved, so that the port complies with BSD-2.

#### Acceptance Criteria

1. THE Game_Engine SHALL carry, in the first comment block of every source file that ports Open Adventure code, the upstream BSD-2 copyright notice (copyright holder line, license name, and the redistribution conditions text) exactly as it appears in the upstream `COPYING` file.
2. THE Game_Engine SHALL place, immediately above each function ported from Open Adventure, a comment that names the corresponding Open Adventure C function by its exact C identifier (for example, `get_next_lcg_value`).
3. THE project SHALL specify every dependency in the package manifest with an exact version string, with no range operators (`^`, `~`, `>`, `<`, `*`, `x`) and no `latest` tags, including Vitest, fast-check, TypeScript and the YAML parser.
4. THE project SHALL include a `.gitignore` file at the repository root containing entries that exclude `node_modules/`, `dist/`, and `.env*`, and SHALL NOT exclude the `.kiro/` directory.
5. IF a ported source file lacks the BSD-2 notice, or a ported function lacks a C-function comment, or a dependency version contains a range operator, THEN THE project's automated test suite SHALL fail and report the offending file, function, or dependency name.
6. WHERE a file is generated from `original/adventure.yaml`, THE project SHALL include in that file a header comment stating the regeneration command and the upstream BSD-2 notice.