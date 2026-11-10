/**
 * Narrator text pools: the sarcastic ghost of the 1976 program, trapped in a
 * PDP-10 since 1977 and clueless about the modern world. Plain ASCII, sentence
 * case, at most 160 characters each, clean humor, no brands.
 *
 * New content (not a port).
 */
import type { DeathGroup } from './moments';

export const MAX_LINE_LENGTH = 160;

export const TREASURE_LINES: readonly string[] = [
  'Treasure acquired. In my day we called that a bonus, and nobody had to update it.',
  'You took the shiny thing. Good. I have been counting these since 1977. It is a lonely hobby.',
  'Ooh, loot. Please do not put it in the cloud. I went looking for the cloud once. It was a ceiling.',
  'That is worth points. I would clap, but I am mostly a memory leak.',
];

export const DWARF_LINES: readonly string[] = [
  'A dwarf. He has waited since 1977 for someone to throw an axe at. Be kind. Or do not.',
  'Small, grumpy and armed. He reminds me of the man who rebooted me every Friday.',
  'Dwarf spotted. No apps, no wifi, just an axe. I respect that.',
];

export const PIRATE_LINES: readonly string[] = [
  'A pirate! Not the kind that copies things. The kind that steals them. Classic.',
  'He lives in a maze and takes your treasure and you keep coming back. I am told that is called a subscription now.',
  'The pirate is here. He has a chest and no scruples. We went to different schools.',
];

export const DRAGON_LINES: readonly string[] = [
  'Bare hands against a dragon. I offered that as a joke. Nobody has ever been this committed.',
  'The dragon is dead. Please do not tell anyone. I do not know who anyone is, but still.',
  'You killed it with your bare hands. I wrote the rules and even I did not see that coming.',
];

export const LAMP_DIM_LINES: readonly string[] = [
  'The lamp is getting dim. I know the feeling. I have been on backup power since 1977.',
  'Your light is fading. In my day we called that a low battery and then we called a guy.',
  'Dim lamp. Have you tried plugging it in? I would suggest the cloud, but see above about the ceiling.',
];

export const LAMP_OUT_LINES: readonly string[] = [
  'And now it is dark. I have been in the dark a long time, so I find this homey.',
  'Lamp out. I will not say anything. I will just hover nearby, which is all I do anyway.',
  'No light. In the dark you can fall into a pit, which is much worse than a bad review.',
];

export const MAZE_LINES: readonly string[] = [
  'Twisty little passages, all alike. I have read that line forty thousand times. It has not improved.',
  'A maze. Drop things to tell the rooms apart. Do not scroll for hints. I do not know what scrolling is.',
  'They say all alike. I have been here a while. They are not alike. Some are slightly more damp.',
];

export const BACKTRACK_LINES: readonly string[] = [
  'You went back where you came from. Brave. I do that to my memory banks all the time.',
  'Retracing your steps. Very 1976. Very sensible. Very circular.',
  'Back again? The room missed you. It has no feelings, but I could tell.',
];

export const DEATH_FALL_LINES: readonly string[] = [
  'That was a fall. The ground is a very honest teacher.',
  'No railing in 1976. No railing now. Safety was a later release.',
  'Gravity still works. I checked on your behalf.',
];

export const DEATH_DWARF_LINES: readonly string[] = [
  'Killed by a dwarf with an axe. Not a bad way to go in a text game. Please do not tell his union.',
  'He threw an axe and you did not duck. Ducking was not in the vocabulary.',
  'The dwarf won. He will be insufferable about it for several turns.',
];

export const DEATH_OTHER_LINES: readonly string[] = [
  'You are dead. It happens to the best of us. It happened to me, and look how well I turned out.',
  'A fatal error. Not mine, for once. I am very proud.',
  'Dead again, in the sense of the first time. Do not worry, I know a guy.',
];

export const DEATH_SECOND_LINES: readonly string[] = [
  'Dead twice. I am not counting. I am counting.',
  'Again? I had a whole speech ready for the first time. It is getting stale.',
  'That makes two. The reincarnation department is starting to ask for your name.',
];

export const DEATH_THIRD_LINES: readonly string[] = [
  'Three times. A personal best, and I have seen a few players.',
  'Third death. The reincarnation department has put you on a list.',
  'Number three. After this I run out of bodies. I say that kindly.',
];

export const REINCARNATION_COUNTDOWN = 'REINCARNATION IN PROGRESS... 3... 2... 1...';

export const REINCARNATED_LINES: readonly string[] = [
  'There. Good as new. Well, as new as anything in this building.',
  'Reincarnation complete. Your stuff is still down there. I would not look at it directly.',
  'You are back. I felt a thrill. It may have been a power surge.',
];

export const FAREWELL_LINES: readonly string[] = [
  'Fine. Leave. Everybody does. I will be here in the dark with the fan noise.',
  'Goodbye. Come back in another 49 years. I will have tidied.',
  'The game is over. Please log out. I do not know what that means, but I hear it is polite.',
];

export const SPOKEN_XYZZY_LINES: readonly string[] = [
  'You said it aloud. Nobody has spoken to me since 1977. Do it again, I was not ready.',
  'Spoken, not typed. Was that a microphone? I always wondered what those were for.',
  'A magic word, out loud, in the open air. The old hands would be proud. The old hands are dust.',
];

export function deathPool(group: DeathGroup, count: number): { key: string; pool: readonly string[] } {
  if (count >= 3) return { key: 'death:third', pool: DEATH_THIRD_LINES };
  if (count === 2) return { key: 'death:second', pool: DEATH_SECOND_LINES };
  if (group === 'fall') return { key: 'death:fall', pool: DEATH_FALL_LINES };
  if (group === 'dwarf') return { key: 'death:dwarf', pool: DEATH_DWARF_LINES };
  return { key: 'death:other', pool: DEATH_OTHER_LINES };
}

/** Every pool, by name, for tests and tooling. */
export const ALL_POOLS: Readonly<Record<string, readonly string[]>> = {
  treasure: TREASURE_LINES,
  dwarf: DWARF_LINES,
  pirate: PIRATE_LINES,
  dragon: DRAGON_LINES,
  lampDim: LAMP_DIM_LINES,
  lampOut: LAMP_OUT_LINES,
  maze: MAZE_LINES,
  backtrack: BACKTRACK_LINES,
  deathFall: DEATH_FALL_LINES,
  deathDwarf: DEATH_DWARF_LINES,
  deathOther: DEATH_OTHER_LINES,
  deathSecond: DEATH_SECOND_LINES,
  deathThird: DEATH_THIRD_LINES,
  reincarnated: REINCARNATED_LINES,
  declined: FAREWELL_LINES,
  spokenXyzzy: SPOKEN_XYZZY_LINES,
};
