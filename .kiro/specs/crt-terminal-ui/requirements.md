# Requirements Document

## Introduction

This spec covers the browser front end of ADVENT: Resurrected. It puts the existing Game_Engine (`src/engine`, spec `game-engine`) behind a retro green CRT terminal that a player can open from a URL with no install and no login. This spec is typing only. Voice input, the AI parser, voice output, the narrator and the haunting effects belong to later specs, but this spec leaves clean extension points for them.

The UI layer sits at the top of the dependency chain (`ui` -> `haunt`/`parser`/`voice` -> `engine`). It depends on the engine's public API only: `newGame`, `start`, `step`, `endOfInput`, `render`, `serialize`, `deserialize`, the `Storage` and `Env` types, and the `OutputEvent` union.

Facts about the engine that shape these requirements:

- `step` consumes one line and returns events. Text-carrying events render to the exact stdout bytes of the C program through `render`.
- The engine emits `echo` text events that repeat the player's input line, plus `io` events (such as the blank line printed before each prompt). A terminal that already shows what the player typed uses `render(events, { echo: false })`, as the CLI does.
- Whenever the engine waits for input it emits a `prompt` event of kind `command`, `yesno` or `filename`.
- SAVE and RESUME ask the player for a file name and go through the injected synchronous `Storage` (`read` returns `undefined` on failure, `write` returns `false` on failure). A successful SAVE ends the game session (`status = 'over'`), and RESUME replaces only the `game` part of the state.
- `serialize` and `deserialize` convert the whole state to and from a JSON string. `deserialize` never throws.
- After the game has ended, any further input yields a single `game-over` event and no state change.
- The engine takes its seed from the caller. The UI may use the clock to choose a seed; the engine may not.
- `newGame(seed, { oldstyle })` fixes the engine's `oldstyle` setting for the whole session; it is stored in `session.settings.oldstyle` and survives `serialize` and `deserialize`. With `oldstyle` on, the engine behaves like the original 1976 program (no `> ` prompt, uppercased and truncated tokens, and the "Initialising..." line). With `oldstyle` off, it behaves like the modern Open Adventure default.

## Glossary

- **Terminal_UI**: The browser front end defined by this spec, living in `src/ui` and `index.html`.
- **Game_Engine**: The pure TypeScript engine in `src/engine`, used only through its public API in `src/engine/index.ts`.
- **Output_Event**: A member of the engine's `OutputEvent` union.
- **Original_Text**: The text produced by `render(events, { echo: false })` for the text-carrying Output_Events of one engine call. The Terminal_UI never alters, reflows, re-cases or abbreviates it.
- **Transcript**: The scrolling sequence of lines shown on the Screen, made of boot text, Original_Text, the player's echoed input lines and UI notices.
- **Screen**: The visible terminal area, including the Transcript and the Input_Line.
- **Input_Line**: The editable line at the bottom of the Transcript, made of the current prompt text, the typed text and the Cursor.
- **Cursor**: The blinking block cursor shown on the Input_Line.
- **CRT_Effects**: The visual treatment that imitates a CRT monitor: scanlines, screen curvature, phosphor glow and flicker.
- **Boot_Sequence**: The scripted fake PDP-10 start-up shown before the game's first text. It has two variants: the Full_Boot and the Short_Boot.
- **Full_Boot**: The Boot_Sequence variant played when no valid Autosave entry exists.
- **Short_Boot**: The Boot_Sequence variant played when a valid Autosave entry exists. It lasts between 1 s and 2 s unless skipped.
- **Boot_Speed**: The fixed Teletype_Printer rate of the Boot_Sequence, 30 characters per second, independent of the Typing_Speed.
- **Teletype_Printer**: The component that reveals output text character by character.
- **Typing_Speed**: The Teletype_Printer rate for game output in characters per second, or the value `instant`. It does not apply to the Boot_Sequence.
- **Command_History**: The list of previously submitted input lines, navigable with the Up and Down arrow keys.
- **Autosave**: The Terminal_UI's automatic persistence of the serialized game state to `localStorage`.
- **Save_Store**: The Terminal_UI's implementation of the engine `Storage` interface, backed by `localStorage`.
- **Mode**: The stored setting `1976` or `haunted` that the player has selected. `haunted` is the default. A change of Mode applies to the next new game only.
- **Game_Mode**: The mode of the game that is currently running: `1976` when `session.settings.oldstyle` of the current Game_Engine state is true, otherwise `haunted`. It is fixed for the lifetime of that game.
- **New_Game_Start**: Any moment at which the Terminal_UI calls `newGame` and `start`: the first start without a valid Autosave entry, "New game" from the UI controls, and a new game after `game-over`.
- **Settings_Record**: The `localStorage` entry holding Mode, Typing_Speed and the CRT_Effects toggle.
- **VT323_Font**: The VT323 typeface, licensed under the SIL Open Font License (OFL), self-hosted from `public/`.
- **Font_Stack**: The CSS `font-family` list that names VT323_Font first, followed by generic monospace fallbacks.
- **Credits_File**: The file `CREDITS.md` at the repository root, which records third-party assets and their licenses.
- **Extension_Hooks**: The typed registration points that later specs use to plug in input transformers, event observers, extra narrator lines and speech output.
- **Narrator_Line**: A line added by a later spec that is not Original_Text. It is shown in a visually distinct style.
- **CI_Workflow**: The GitHub Actions workflow in `.github/workflows` that runs the typecheck and the test suite.
- **Build_Script**: The npm script that produces the static site for Cloudflare Pages.
- **Reduced_Motion_Preference**: The browser's `prefers-reduced-motion: reduce` media setting.

## Requirements

### Requirement 1: Playable from a URL

**User Story:** As a judge or player, I want to open one URL and play the whole game, so that I need no install, account or setup.

#### Acceptance Criteria

1. WHEN the page finishes loading in Chrome, Edge or Safari, THE Terminal_UI SHALL start the Boot_Sequence without any login, install step or permission prompt.
2. THE Terminal_UI SHALL run the Game_Engine entirely in the browser, with no network request made after the initial page assets have loaded.
3. THE Terminal_UI SHALL load all scripts, styles and fonts, including VT323_Font, from the same origin as the page.
4. WHEN the player submits input lines to the end of the game, THE Terminal_UI SHALL deliver every line to the Game_Engine with `step` and SHALL display the Original_Text of every result, so that the full 430-point game is completable in the browser.
5. THE Terminal_UI SHALL import only the public API of the Game_Engine (`src/engine/index.ts`) and SHALL NOT import from `src/haunt`, `src/parser` or `src/voice`.
6. THE Game_Engine SHALL import nothing from `src/ui`.

### Requirement 2: Retro green CRT look

**User Story:** As a player, I want the game to look like a green phosphor CRT, so that it feels like a resurrected 1976 terminal.

#### Acceptance Criteria

1. THE Terminal_UI SHALL render the Screen with the Font_Stack, green text on a near-black background, and a CSS-only text glow.
2. THE Terminal_UI SHALL draw horizontal scanlines over the Screen with a repeating pattern that has a period between 2 px and 4 px.
3. THE Terminal_UI SHALL apply a screen curvature effect and a vignette at the Screen edges.
4. THE Terminal_UI SHALL animate a flicker whose luminance change is at most 5 percent between its brightest and dimmest frames, and whose rate is at most 3 cycles per second.
5. THE Terminal_UI SHALL show the Cursor as a solid block that blinks with a period between 0.8 s and 1.2 s.
6. THE Terminal_UI SHALL keep the contrast ratio between body text and its background at 4.5:1 or higher with CRT_Effects on.
7. WHILE the Reduced_Motion_Preference is set, THE Terminal_UI SHALL disable the flicker animation, the Cursor blink, and any animation or transition of the curvature or vignette, and SHALL show the Cursor as a steady solid block.
8. THE Terminal_UI SHALL provide a toggle that turns CRT_Effects off and on, and SHALL store the choice in the Settings_Record.
9. WHILE CRT_Effects are off, THE Terminal_UI SHALL show plain green text on a plain dark background with no scanlines, curvature, glow or flicker.
10. THE Terminal_UI SHALL draw CRT_Effects with CSS and Canvas only, with no raster or video assets from third parties.
11. THE Terminal_UI SHALL NOT use the strings "Colossal Cave" or "Zork" in the page title, headings, visible UI text, or file names.
12. THE Terminal_UI SHALL serve VT323_Font as a self-hosted `woff2` file from `public/` and SHALL load it with an `@font-face` rule that uses `font-display: swap`.
13. THE Font_Stack SHALL list VT323_Font first, followed by `"Courier New"`, `Courier` and the generic family `monospace`, so that the Screen stays monospace if VT323_Font fails to load.
14. THE Terminal_UI SHALL use the Font_Stack for the Transcript, the Input_Line and every control.
15. THE repository SHALL include the VT323_Font license text (the SIL Open Font License) next to the font file in `public/`.
16. THE Credits_File SHALL name VT323_Font, its author, and the SIL Open Font License, and SHALL state that the font file is bundled in `public/`.
17. WHEN the test suite runs, THE test suite SHALL check that the Credits_File exists, that it mentions "VT323", and that it mentions "SIL Open Font License" or "OFL".
18. WHEN the test suite runs, THE test suite SHALL check that the font file named in the `@font-face` rule exists in `public/`.

### Requirement 3: Mobile and on-screen keyboard

**User Story:** As a player on a phone, I want to type commands with the on-screen keyboard, so that I can play without a physical keyboard.

#### Acceptance Criteria

1. THE Terminal_UI SHALL declare a responsive viewport and SHALL lay out the Screen without horizontal page scrolling at viewport widths from 320 px to 1920 px.
2. THE Terminal_UI SHALL render the Input_Line with a real text input element, so that the operating system's on-screen keyboard can open.
3. THE Terminal_UI SHALL use an input font size of at least 16 px, so that iOS Safari does not zoom the page on focus.
4. WHEN the player taps anywhere on the Screen, THE Terminal_UI SHALL focus the input element.
5. WHEN the visual viewport height changes because the on-screen keyboard opens or closes, THE Terminal_UI SHALL keep the Input_Line fully visible within 300 ms.
6. THE Terminal_UI SHALL set the input element's autocapitalize, autocorrect, autocomplete and spellcheck attributes to disable them, so that mobile keyboards do not alter commands.
7. THE Terminal_UI SHALL use a body text size of at least 14 px at a 320 px viewport width.
8. WHILE CRT_Effects are on at a viewport width below 600 px, THE Terminal_UI SHALL reduce the curvature and vignette strength so that every character on the Screen stays inside the visible area.

### Requirement 4: Boot sequence

**User Story:** As a player, I want to watch a fake PDP-10 boot that fails and then resurrects the game, so that the 49-year gap is part of the experience.

#### Acceptance Criteria

1. WHEN the page loads, THE Terminal_UI SHALL play the Boot_Sequence before the first game text, in both Modes.
2. WHEN the page loads and no valid Autosave entry exists, THE Terminal_UI SHALL play the Full_Boot.
3. WHEN the page loads and a valid Autosave entry exists (one that `deserialize` accepts), THE Terminal_UI SHALL play the Short_Boot instead of the Full_Boot.
4. THE Full_Boot SHALL show, in this order, a fake PDP-10 start-up text, the line `LOADING ADVENT ... FAILED`, the line `RETRYING AFTER 49 YEARS ...`, and the line `RESURRECTING`.
5. THE Short_Boot SHALL show, in this order, the line `RETRYING AFTER 49 YEARS ...` and the line `RESURRECTING`, and SHALL last between 1 s and 2 s from its first character to its last when it is not skipped.
6. THE Terminal_UI SHALL reveal the Boot_Sequence at the Boot_Speed of 30 characters per second, regardless of the Typing_Speed in the Settings_Record.
7. WHILE no key is pressed and the Reduced_Motion_Preference is not set, THE Full_Boot SHALL complete within 10 seconds of the page load.
8. WHEN the Boot_Sequence reaches its end, THE Terminal_UI SHALL either start the Game_Engine for a New_Game_Start or restore the Autosave entry (Requirement 9), and SHALL print the opening Original_Text through the Teletype_Printer.
9. WHEN the player presses any key or taps the Screen during the Boot_Sequence, THE Terminal_UI SHALL show the remaining Boot_Sequence lines at once, continue as in criterion 8, and SHALL NOT insert that key into the Input_Line.
10. WHILE the Reduced_Motion_Preference is set, THE Terminal_UI SHALL show the full text of the Boot_Sequence at once, with no per-character animation and no delay between lines.
11. THE Boot_Sequence SHALL contain no third-party trademarks and SHALL be defined as data (arrays of lines with delays, one for the Full_Boot and one for the Short_Boot) separate from the code that plays it.
12. THE Terminal_UI SHALL accept player input only after the Game_Engine has started.

### Requirement 5: Rendering engine output

**User Story:** As a player, I want to see the game's text exactly as the original program prints it, so that the game stays faithful.

#### Acceptance Criteria

1. WHEN the Game_Engine returns events from `start`, `step` or `endOfInput`, THE Terminal_UI SHALL append the Original_Text of those events to the Transcript in event order.
2. THE Terminal_UI SHALL produce Original_Text with the engine's `render` function using `{ echo: false }`, and SHALL preserve every character, space and blank line it returns.
3. THE Terminal_UI SHALL display Original_Text in a preformatted monospace layout in which line breaks and runs of spaces are preserved and no line is re-wrapped by script.
4. WHEN the player submits a line, THE Terminal_UI SHALL append the current prompt text followed by the submitted line to the Transcript before the engine's output for that line.
5. WHEN the Game_Engine emits a `prompt` event, THE Terminal_UI SHALL show the event's `text` as the prompt of the Input_Line and SHALL record its `kind`.
6. WHEN the Game_Engine emits events other than `text` and `prompt` (`room-entered`, `lamp-level`, `death`, `reincarnation-offered`, `magic-word-used`, `score`, `game-over`), THE Terminal_UI SHALL leave the Transcript unchanged and SHALL pass each event to the registered event observers.
7. WHEN the Game_Engine emits a `game-over` event, THE Terminal_UI SHALL show a notice line that offers to start a new game, and SHALL keep the Original_Text of that step visible above it.
8. FOR ALL event sequences, the Original_Text concatenated from the Transcript's engine-output lines SHALL equal the concatenation of `render(events, { echo: false })` over the same sequences (rendering fidelity property).
9. THE Terminal_UI SHALL escape Original_Text as plain text when it writes to the DOM, so that no engine string is interpreted as HTML.
10. IF the Game_Engine throws an exception, THEN THE Terminal_UI SHALL keep the previous game state, print the line `?SYSTEM ERROR - COMMAND IGNORED` to the Transcript, and keep accepting input.
11. WHEN the Transcript holds more than 2000 lines, THE Terminal_UI SHALL remove the oldest lines so that the Transcript holds no more than 2000 lines.
12. WHEN the Transcript changes, THE Terminal_UI SHALL scroll the Screen so that the Input_Line stays visible, unless the player has scrolled up manually.

### Requirement 6: Teletype typing

**User Story:** As a player, I want text to print like a teletype, with a speed I can change and skip, so that I get the retro feel without waiting.

#### Acceptance Criteria

1. WHEN the Terminal_UI appends output text to the Transcript, THE Teletype_Printer SHALL reveal the text character by character at the current Typing_Speed.
2. THE Terminal_UI SHALL provide a Typing_Speed control with exactly these choices: 20, 60, 120 and 300 characters per second, and `instant`.
3. THE Terminal_UI SHALL use 120 characters per second as the default Typing_Speed.
4. WHEN the player changes the Typing_Speed, THE Terminal_UI SHALL apply the new speed to the next character revealed and SHALL store it in the Settings_Record.
5. WHEN the player presses a key during teletype output, THE Teletype_Printer SHALL reveal all pending output at once within one animation frame.
6. WHILE the Typing_Speed is `instant`, THE Teletype_Printer SHALL reveal each output block in the same frame it is appended.
7. WHILE the Reduced_Motion_Preference is set, THE Teletype_Printer SHALL reveal each output block in the same frame it is appended, whatever Typing_Speed the Settings_Record holds, and THE Terminal_UI SHALL leave the stored Typing_Speed unchanged.
8. WHILE the Teletype_Printer has pending output, THE Terminal_UI SHALL accept typed characters into the Input_Line and SHALL hold submission of a line until the pending output has been revealed.
9. THE Teletype_Printer SHALL reveal exactly the characters of the output text, in order, so that the text visible after the reveal equals the output text.
10. WHEN output text is revealed, THE Terminal_UI SHALL add the full text of the block to a visually hidden `aria-live="polite"` region at once, and SHALL mark the animated Transcript as `aria-hidden` while animating, so that screen readers do not read one character at a time.

### Requirement 7: Input line and submission

**User Story:** As a player, I want a normal command line with a blinking cursor, so that I can type, correct and submit commands.

#### Acceptance Criteria

1. WHEN the player presses Enter, THE Terminal_UI SHALL submit the current Input_Line text to the Game_Engine with `step` and SHALL clear the input element.
2. THE Terminal_UI SHALL submit the typed text unchanged, with no trimming, case change or synonym replacement.
3. THE Terminal_UI SHALL limit the input element to 1023 characters, the engine's line capacity.
4. WHEN the player submits an empty line, THE Terminal_UI SHALL pass the empty line to the Game_Engine like any other line.
5. WHEN the player presses Backspace, Delete, Left or Right, THE Terminal_UI SHALL edit the typed text and move the Cursor as a standard text input does.
6. WHILE the Game_Engine has returned a `prompt` event of kind `filename`, THE Terminal_UI SHALL submit the typed text as the file name with no change.
7. WHILE the pending prompt is `command` or `yesno`, THE Terminal_UI SHALL make no distinction in how input is submitted, so that the Game_Engine decides how to interpret each line.
8. THE Terminal_UI SHALL position the Cursor block at the caret position of the input element, within one character cell.

### Requirement 8: Command history

**User Story:** As a player, I want to recall earlier commands with the arrow keys, so that I can repeat and edit commands quickly.

#### Acceptance Criteria

1. WHEN the player submits a non-empty line, THE Command_History SHALL append the line, unless it equals the most recent history entry.
2. WHEN the player presses Up on the Input_Line, THE Terminal_UI SHALL replace the typed text with the previous history entry, or keep the oldest entry when no earlier one exists.
3. WHEN the player presses Down while browsing history, THE Terminal_UI SHALL show the next newer entry, and SHALL restore the text the player had typed before browsing when the newest entry is passed.
4. WHEN the player submits a line, THE Command_History SHALL reset its browsing position to "not browsing".
5. THE Command_History SHALL hold at most 100 entries and SHALL drop the oldest entry when a new entry would exceed that limit.
6. THE Terminal_UI SHALL move the Cursor to the end of the text after an Up or Down recall.
7. THE Terminal_UI SHALL store the Command_History in `localStorage` and SHALL load it at start-up.
8. IF the stored Command_History is missing, is not a JSON array of strings, or cannot be read, THEN THE Terminal_UI SHALL start with an empty Command_History.
9. FOR ALL sequences of Up and Down presses, the browsing position SHALL stay within the range from "not browsing" to the oldest entry (history bounds property).

### Requirement 9: Autosave and restore

**User Story:** As a player, I want my game saved automatically in the browser, so that closing the tab does not lose my progress.

#### Acceptance Criteria

1. WHEN a `step` call completes and the resulting `session.status` is `running`, THE Terminal_UI SHALL write the string returned by `serialize` of the new state, together with the last 200 Transcript lines, to a single `localStorage` entry reserved for Autosave.
2. WHEN the Boot_Sequence ends and a valid Autosave entry exists, THE Terminal_UI SHALL restore the state with `deserialize`, restore the saved Transcript lines, print the line `RESUMING SAVED SESSION`, and show the Input_Line with the prompt of the restored state, instead of calling `start` for a new game; the Game_Mode of the restored game SHALL be the mode given by the restored `session.settings.oldstyle`, whatever the selected Mode is.
3. IF `deserialize` returns a rejection for the Autosave entry, or the entry is not valid JSON, THEN THE Terminal_UI SHALL delete the Autosave entry and perform a New_Game_Start.
4. WHEN the Game_Engine's `session.status` becomes `over`, THE Terminal_UI SHALL delete the Autosave entry.
5. WHEN the player chooses "New game" from the UI controls, THE Terminal_UI SHALL ask for confirmation, then delete the Autosave entry, clear the Transcript, choose a new seed from the clock, and perform a New_Game_Start.
6. WHEN the player starts a new game after a `game-over` event, THE Terminal_UI SHALL choose a new seed from the clock, clear the Transcript, and perform a New_Game_Start.
7. IF `localStorage` is unavailable or a write throws (private mode, quota exceeded, disabled storage), THEN THE Terminal_UI SHALL keep the game playable, hold Autosave and Save_Store data in memory for the page's lifetime, and show one notice line `SAVES WILL NOT SURVIVE A RELOAD`.
8. FOR ALL game states reached by any command sequence, restoring from `serialize` and replaying any further command sequence SHALL produce the same Original_Text as continuing the original state (Autosave round-trip property).
9. THE Terminal_UI SHALL limit the stored Autosave entry to a size that fits `localStorage` and SHALL drop Transcript lines, oldest first, before it drops the serialized state.

### Requirement 10: Engine Storage adapter for SAVE and RESUME

**User Story:** As a player, I want the game's own SAVE and RESUME commands to work in the browser, so that the original commands keep working.

#### Acceptance Criteria

1. THE Save_Store SHALL implement the engine `Storage` interface and SHALL be passed to every `start`, `step` and `endOfInput` call as `env.storage`.
2. WHEN the engine calls `Save_Store.write(name, data)`, THE Save_Store SHALL store `data` in `localStorage` under a key made of the fixed prefix `advent:file:` and `name`, and SHALL return `true`.
3. IF a `localStorage` write throws, THEN THE Save_Store SHALL return `false`.
4. WHEN the engine calls `Save_Store.read(name)`, THE Save_Store SHALL return the stored text for the key made of the prefix and `name`, or `undefined` when no such entry exists or reading throws.
5. THE Save_Store SHALL keep the key for Autosave, the key for the Settings_Record and the key for the Command_History outside the `advent:file:` prefix, so that no player-chosen file name can overwrite them.
6. WHEN a SAVE completes and the engine sets `session.status` to `over`, THE Terminal_UI SHALL show the engine's Original_Text for the save and a notice line that offers to start a new game or to use RESUME.
7. WHEN the player runs RESUME with the name of an earlier save in a running game, THE Terminal_UI SHALL continue to the engine's Original_Text for that restore and SHALL then Autosave the resulting state.
8. FOR ALL names and data strings, `Save_Store.read(name)` after `Save_Store.write(name, data)` SHALL return `data` (storage round-trip property).

### Requirement 11: Mode switch

**User Story:** As a player, I want to choose between 1976 mode and Haunted mode, so that I can pick pure original play or the full experience when it exists.

#### Acceptance Criteria

1. THE Terminal_UI SHALL provide a Mode switch with the two choices `1976 MODE` and `HAUNTED MODE`, reachable by keyboard and by touch.
2. THE Terminal_UI SHALL use `haunted` as the Mode when the Settings_Record has no stored Mode.
3. WHEN the player changes the Mode, THE Terminal_UI SHALL store the Mode in the Settings_Record, show the selected Mode in the interface, keep the running game and Transcript unchanged, and print the notice line `MODE CHANGE TAKES EFFECT ON THE NEXT NEW GAME` to the Transcript.
4. WHEN the page loads, THE Terminal_UI SHALL read the Mode from the Settings_Record.
5. IF the stored Mode value is missing or is neither `1976` nor `haunted`, THEN THE Terminal_UI SHALL use `haunted`.
6. WHEN the Terminal_UI performs a New_Game_Start while the selected Mode is `1976`, THE Terminal_UI SHALL call `newGame` with the option `oldstyle` set to true.
7. WHEN the Terminal_UI performs a New_Game_Start while the selected Mode is `haunted`, THE Terminal_UI SHALL call `newGame` with the option `oldstyle` set to false.
8. WHILE a game is running, THE Terminal_UI SHALL keep its Game_Mode unchanged when the selected Mode changes.
9. WHILE the Game_Mode is `1976`, THE Terminal_UI SHALL NOT invoke any registered Extension_Hook.
10. WHILE the Game_Mode is `haunted` in this release, THE Terminal_UI SHALL add no behavior beyond the engine's `oldstyle` setting being off, because no Extension_Hook is registered and the haunted-only features belong to later specs.
11. THE Terminal_UI SHALL expose the current Game_Mode and the selected Mode to Extension_Hook handlers as read-only values.

### Requirement 12: Extension hooks for later specs

**User Story:** As a developer of the voice, AI and haunting specs, I want stable hook points in the UI, so that I can add features without rewriting the terminal.

#### Acceptance Criteria

1. THE Terminal_UI SHALL define a typed `Extension_Hooks` registry in `src/ui` with four hook kinds: input transformer, event observer, narrator-line provider, and output listener.
2. WHEN the player submits a line while the Game_Mode is `haunted`, THE Terminal_UI SHALL pass the line through the registered input transformers in registration order and SHALL send the final string to the Game_Engine, with the player's original line still shown in the Transcript.
3. WHEN the Game_Engine returns events while the Game_Mode is `haunted`, THE Terminal_UI SHALL pass the events to each registered event observer after the Original_Text has been appended to the Transcript.
4. WHEN a narrator-line provider returns lines, THE Terminal_UI SHALL append them to the Transcript after the Original_Text of the same step, each marked as a Narrator_Line with a CSS class that differs from the Original_Text class.
5. WHEN output text is revealed, THE Terminal_UI SHALL call each registered output listener with the text of the revealed block, so that a later spec can speak it.
6. IF a hook handler throws an exception or returns an invalid value, THEN THE Terminal_UI SHALL skip that handler for that call, log the error to the browser console, and continue with the unchanged line or events.
7. THE Terminal_UI SHALL guarantee that no hook can remove or edit Original_Text that is already in the Transcript.
8. WHEN no hook is registered, THE Terminal_UI SHALL send the typed line to the Game_Engine unchanged.
9. WHEN a Narrator_Line is appended, THE Terminal_UI SHALL leave the Autosave state and the Command_History unaffected by its text.

### Requirement 13: Settings persistence

**User Story:** As a player, I want my display and mode choices remembered, so that I do not set them again on every visit.

#### Acceptance Criteria

1. WHEN the player changes Mode, Typing_Speed or the CRT_Effects toggle, THE Terminal_UI SHALL write the Settings_Record as one JSON object to `localStorage`.
2. WHEN the page loads, THE Terminal_UI SHALL read the Settings_Record and apply the stored Mode, Typing_Speed and CRT_Effects toggle before the Boot_Sequence starts.
3. IF the Settings_Record is missing, is not valid JSON, or holds a value outside the allowed choices, THEN THE Terminal_UI SHALL use the default for that setting (`haunted`, 120 characters per second, CRT_Effects on).
4. FOR ALL valid settings values, parsing the stored text produced by writing the Settings_Record SHALL return an equivalent settings value (settings round-trip property).
5. THE Terminal_UI SHALL provide a pretty printer for the Settings_Record and a parser for it as separate functions, so that the round-trip property can be tested.

### Requirement 14: Keyboard and accessibility

**User Story:** As a player who uses a keyboard or assistive technology, I want the terminal to be operable and readable, so that I can play the game.

#### Acceptance Criteria

1. THE Terminal_UI SHALL make every control (Mode switch, Typing_Speed, CRT_Effects toggle, New game) reachable by Tab and operable with Enter or Space.
2. THE Terminal_UI SHALL label each control with visible text or an `aria-label`.
3. WHEN the page loads, THE Terminal_UI SHALL focus the input element, unless the Boot_Sequence is still running.
4. THE Terminal_UI SHALL show a visible focus outline on every control, with a contrast ratio of at least 3:1 against its surroundings.
5. THE Terminal_UI SHALL give the page a `lang="en"` attribute and the title `ADVENT: Resurrected`.

### Requirement 15: Testable UI logic

**User Story:** As a developer, I want the UI logic separated from the DOM, so that I can unit test it and the existing engine tests stay green.

#### Acceptance Criteria

1. THE Terminal_UI SHALL implement event rendering, Command_History, Autosave, Save_Store, Settings_Record parsing and printing, Teletype_Printer scheduling, Boot_Sequence data, and the Extension_Hooks registry as modules with no direct access to `document`, `window` or `localStorage`; the Terminal_UI SHALL pass those in through small interfaces.
2. THE Terminal_UI SHALL include Vitest unit tests for event rendering, Command_History, Autosave and the Save_Store, for the Settings_Record, for the Boot_Sequence data and variant selection, and for the choice of the `oldstyle` option from the selected Mode.
3. THE Terminal_UI SHALL include fast-check property tests for the rendering fidelity property (5.8), the history bounds property (8.9), the Autosave round-trip property (9.8), the storage round-trip property (10.8), and the settings round-trip property (13.4).
4. THE Terminal_UI SHALL include a Vitest test that plays the `win430` upstream log through the UI's controller module with a fake clock and an in-memory storage, using the same game options as the upstream test harness, and that checks the score carried by the final `game-over` event is 430 (not the last `score` event, which excludes the end-of-game bonuses) and the Original_Text equals the engine's expected output with echo events removed.
5. WHEN the full test suite runs with `vitest --run`, THE test suite SHALL pass all existing tests, without edits to them.
6. THE existing layering lint test SHALL continue to pass, and SHALL be extended to reject any import of `src/ui` from `src/engine`.
7. WHERE the unit tests need a DOM, THE test suite SHALL use only a pinned test environment dependency, and SHALL keep the engine tests running in the Node environment.

### Requirement 16: Build and Cloudflare Pages deployment

**User Story:** As the project owner, I want a repeatable build that Cloudflare Pages can deploy, so that the game has a public URL.

#### Acceptance Criteria

1. THE Build_Script SHALL be the npm script `build`, which runs the typecheck and then `vite build`, and SHALL write a static site to the `dist` directory.
2. WHEN `npm run build` completes, THE `dist` directory SHALL contain `index.html` and all assets that it references, using relative or root-relative URLs that work at the site root.
3. IF the typecheck or `vite build` fails, THEN THE Build_Script SHALL exit with a non-zero status.
4. THE Build_Script SHALL NOT require any API key, secret or environment variable.
5. THE repository SHALL document, in `README.md`, the Cloudflare Pages settings (build command `npm run build`, output directory `dist`, and the Node version) and the manual first-deploy steps, and SHALL include a `wrangler.toml` that holds only non-secret Pages settings.
6. THE build SHALL include the license notices for the engine and the game data (the BSD-2 text and the attribution in `original/ATTRIBUTION.md`) in a page reachable from the Terminal_UI through a visible "Credits" link, which may name the historical title of the game in the credits text.
7. THE Terminal_UI SHALL add no new runtime dependency, and any new dev dependency SHALL be pinned to an exact version.
8. THE `.gitignore` SHALL keep excluding `node_modules/`, `dist/`, and `.env*`.
9. THE `dist` directory SHALL contain the VT323_Font file and its license text.
10. THE Credits link page SHALL name VT323_Font and the SIL Open Font License.
11. THE implementation of this spec SHALL NOT run `wrangler login`, `wrangler pages deploy` or any other deploy command, and neither the CI_Workflow nor the Build_Script SHALL deploy; the first deploy is performed manually by the user following the `README.md` steps.

### Requirement 17: Continuous integration

**User Story:** As a developer, I want every push checked automatically, so that a broken change is caught early.

#### Acceptance Criteria

1. THE CI_Workflow SHALL be a file in `.github/workflows` that runs on every `push` event.
2. WHEN the CI_Workflow runs, THE CI_Workflow SHALL check out the repository, install dependencies with `npm ci`, run `npm run typecheck`, and run `npx vitest --run`.
3. IF the typecheck or the test run exits with a non-zero status, THEN THE CI_Workflow SHALL fail.
4. THE CI_Workflow SHALL use a fixed Node.js major version, and SHALL pin each third-party action to an exact version tag.
5. THE CI_Workflow SHALL use no secrets.
6. THE CI_Workflow SHALL run the replay of the upstream logs, as part of the full `vitest --run`, without skipping any test that is not on the engine's Skip_List.
