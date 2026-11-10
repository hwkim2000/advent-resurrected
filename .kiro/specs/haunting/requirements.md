# Requirements Document

## Introduction

Spec 5 adds the haunting to Haunted mode: a sarcastic narrator (the ghost of the 1976 program, trapped in a PDP-10 since 1977 and clueless about the modern world), a dimming screen, a glitching maze, a polished reincarnation scene, a reaction to a spoken XYZZY, and a batch of UX fixes found in real testing. Tone is FUNNY, not scary. English only, clean humor, no third-party trademarks.

Ground rules that apply to every requirement below:

- 1976 mode is untouched: no narrator, no dimming, no glitch, no new prompts, no new code loaded. `tests/ui-layering.test.ts` rules still hold (`src/haunt` imports nothing from `src/ui`, `src/voice` or `src/parser`; the engine imports nothing from `src/haunt`).
- Original game text is always printed first and unchanged. Narrator lines are extra, dimmed, distinct lines (`LineKind` `narrator`) and never replace or edit original text, and are never sent to the engine.
- Everything is deterministic given the game state and the injected RNG or a seeded haunt picker; narrator choice must not consume the engine's RNG stream (upstream log replays must stay identical).
- Haunting is an enhancement: if any haunt code fails, the game continues with the plain original text.

## Glossary

- **Narrator**: the ghost voice. Lines are short (one or two terminal lines), land without needing explanation, and appear under the original text.
- **Key_Moment**: a game event that may trigger a narrator line (Requirement 1.2). Not every turn.
- **Haunt_Level**: the lamp-driven dim amount, from 0 (full brightness) to a floor that keeps text readable.

## Requirements

### Requirement 1: Narrator lines

**User Story:** As a player, I want the ghost of the old program to heckle me at key moments, so that the game feels haunted and funny without getting in the way.

1. In Haunted mode, the Narrator SHALL print dimmed extra lines directly under the original text for the turn; the original text is printed first and unchanged.
2. Key_Moments SHALL include at least: first treasure taken, first dwarf encounter, the pirate appearing, the dragon "bare hands" kill, the first death, the lamp getting dim, the lamp running out, entering the maze, and the first time the player returns to a room they have just left. A cooldown SHALL keep narrator lines to at most one per N turns (default 3) and at most once per Key_Moment kind per life, except deaths and reincarnation.
3. Each Key_Moment kind SHALL have a pool of at least 3 lines, picked by a seeded haunt picker that does not touch the engine RNG.
4. Lines SHALL stay clueless about the modern world (the Narrator misreads "the cloud", "apps", "wifi", "scrolling", and so on as cave or mainframe things) and SHALL NOT contain gore, profanity or real brand names.
5. Narrator lines SHALL be persisted in the autosave transcript as the existing `narrator` kind and SHALL be read aloud only if voice output exists, in the same robotic voice and after the original text.

### Requirement 2: Lamp dimming

**User Story:** As a player, I want the screen to dim as my lamp battery drains, so that running out of light is felt.

1. In Haunted mode, the display brightness SHALL track the engine's remaining lamp life (`limit`): full brightness while the lamp is healthy, dimming smoothly as it drains, at a floor where text stays readable (contrast of normal text stays at or above 4.5:1 against the background).
2. The dim SHALL reset when the lamp is replenished (batteries), when the lamp is off, and on a new game or reincarnation; it SHALL be a CSS-only change (custom property), with no reflow.
3. When `prefers-reduced-motion` is set, the dim SHALL apply in steps rather than animated.
4. The "lamp is getting dim" and "lamp has run out" game messages stay original; the Narrator MAY add a line after each (Requirement 1.2).

### Requirement 3: "all alike" becomes "all haunted"

**User Story:** As a player, I want the maze's famous line to glitch into something worse, so that the cave feels wrong.

1. In Haunted mode, when the original room text "You are in a maze of twisty little passages, all alike." is shown, the display SHALL flash "all haunted" briefly (about 1 second) in place of "all alike" and then settle back to the unchanged original text "all alike".
2. The transcript, autosave, speech output, the engine, and the AI parser SHALL always see the original text. The glitch is visual only.
3. The glitch SHALL be skipped when `prefers-reduced-motion` is set (the Narrator may add a line instead), and SHALL occur at most once every few visits so it stays special.

### Requirement 4: Reincarnation scene

**User Story:** As a player, I want dying to be the funniest part of the game, so that I look forward to it.

1. On death, the original death text and the original reincarnation offer ("Do you want me to try to reincarnate you?") SHALL appear unchanged and first.
2. The Narrator SHALL then add a death-specific line (at least 3 variants per death cause group: fall, dwarf or axe, drowning or other, and a "nth death" escalation for repeat deaths up to the engine's three-death limit).
3. When the player accepts, the scene SHALL be polished: a short staged sequence (a boot-style "REINCARNATION IN PROGRESS" countdown, brief screen flicker and a synthesized sound), followed by the original reincarnation text and a Narrator line. Total added time SHALL be at most 4 seconds and SHALL be skippable by any key or tap.
4. All effects SHALL respect `prefers-reduced-motion` (plain text sequence, no flicker), and the player's score, items, and engine state after reincarnation SHALL be exactly what the engine produced.
5. When the player declines or the game is over, the Narrator SHALL add a farewell line. 

### Requirement 5: Spoken XYZZY and spoken-input marker

**User Story:** As a player, I want the game to notice when I speak the magic word aloud, and to see which lines I spoke.

1. When a spoken line (Input_Origin `spoken`) is a XYZZY motion word (including a fuzzy-matched alias), the Narrator SHALL add a special reaction line (at least 3 variants), after the original response.
2. Spoken lines SHALL carry a small mic marker in the input echo (for example a mic glyph before the line) so the player can tell spoken from typed lines; the marker is presentation only, is persisted with the line kind so it survives reload, and is not sent to the engine.
3. The existing typed-XYZZY deflection stays once per game and keeps its once-per-game flag.

### Requirement 6: UX fixes from real testing

**User Story:** As a player, I want the small frustrations from testing fixed.

1. **Yes/no prompts.** In Haunted mode only, at a yes/no prompt the input "sure", "yeah", "yep", "ok", "okay", "please", "yes please" SHALL count as YES and "nope", "nah", "no thanks", "no thank you" SHALL count as NO. Mapping happens before the engine sees the line and the engine receives the plain `YES` or `NO`. Any other input at a yes/no prompt SHALL still not be passed to the engine as an answer; instead the original "Please answer the question." is replaced in Haunted mode by a one-line ghost nudge (at least 3 variants, for example reminding the player to say yes or no). In 1976 mode the engine's original text is shown unchanged.
2. **XYZZY hint.** The deflection text SHALL be rewritten in the Narrator voice and be funny while still telling the player to say it aloud and how (hold the mic or Alt+M, or type it again). The "66 characters" and "uppercase-only" limits of the old constant are dropped; the new text must still fit the terminal width on one or two lines.
3. **MIC button visibility.** The Mic_Button (and its disclosure) SHALL be fully visible without scrolling at common laptop viewports (at least 1280x720 and 1366x768, and also 1024x600) at default zoom. The fix SHALL not hide the transcript or the input line; verify with a Playwright or manual check and add a CSS or layout test where practical.
4. **AI object disambiguation.** When the AI parser is unsure which object the player means, it SHALL prefer the visible object (in the room or carried) whose name is closest in spelling to the player's word, using a bounded edit distance, over any other candidate. Example: "grab the lab" SHALL become `TAKE LAMP` and not `TAKE FOOD` when the lamp is visible. The result is still validated as a legal classic command or rejected, as before, and the fallback rules are unchanged. Tie-break: exact prefix match first, then smaller edit distance, then vocabulary order. If nothing is within the bound, behavior is unchanged.

### Requirement 7: Resilience and testing

1. Every haunt feature SHALL degrade gracefully: if the haunt module fails to load or throws, the player sees the plain original text and can keep playing.
2. The upstream fidelity suite (every `.log` against its `.chk`), the walkthrough, and all existing tests SHALL still pass unchanged.
3. Tests SHALL cover: narrator never replaces or edits original text (property), narrator never fires in 1976 mode (property), cooldown and per-kind limits, picker determinism and no engine RNG use, dim function monotonic and bounded, glitch is display-only, yes/no alias mapping and the nudge, the object closest-spelling rule including "grab the lab", and the reincarnation sequence being skippable.
4. The main bundle size budget for 1976 mode SHALL not grow; haunt code loads with the Haunted start loader, like the AI and voice chunks.

## Open Questions and Decisions

- Cooldown N, glitch frequency, and the dim floor are starting values; tune during playtesting.
- Decided: the glitch flashes "all haunted" about 1 second, then settles back to "all alike".
