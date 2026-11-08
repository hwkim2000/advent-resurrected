# Product: ADVENT: Resurrected

A funny, haunted resurrection of the 1976 text adventure for the Kiroween 2026 hackathon (Resurrection category). Audience: North American players and judges. English only (UI, voice, parser, narrator).

## Concept
A browser game with a retro green CRT terminal look. The 1976 program "fails to load", then is resurrected after 49 years. The original opening line types out teletype-style.

## Modes
- **1976 mode**: pure original. Two-word typed parser, no voice, no AI, no haunting.
- **Haunted mode** (default): voice input, AI parser, voice output, haunting effects.

## Features
- **Voice input**: English speech-to-text. Typing must always work, in every mode, even if the mic, speech API, or AI is unavailable.
- **AI parser**: maps natural sentences to original commands and shows the translated command dimmed under the input (e.g. "I'll go inside" -> `ENTER BUILDING`). If the AI fails, fall back to the classic parser.
- **Voice output**: original text read aloud in a deliberately robotic 1970s-computer voice (browser speech synthesis).
- **Narrator**: the sarcastic ghost of the original program, trapped in a PDP-10 since 1977 and clueless about the modern world. Its comments appear as extra lines under the original text and never replace it.

## Tone
FUNNY, not scary. Jokes over jump scares. Keep the humor clean and accessible to a North American audience.

## Original moments to keep intact
Opening line, XYZZY/PLUGH, twisty maze, the dragon "bare hands" joke, dwarves, the pirate, and the reincarnation offer on death.

## Haunted effects
- The screen dims as the lamp battery drains.
- "all alike" glitches into "all haunted".
- XYZZY must be spoken aloud (in Haunted mode).
- The reincarnation scene is a highlight; give it extra polish.

## Stretch goals (only if time allows)
- Ghost messages left where other players died.
- A premium narrator voice.

## Content rules
- Never use "Colossal Cave" or "Zork" as a title or brand. Mentioning the historical name in credits/attribution text is fine.
- No third-party trademarks or copyrighted music or sound. Audio must be synthesized or original.
- Judges must be able to play from a URL with no install and no login.
