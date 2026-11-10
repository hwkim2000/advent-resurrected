/**
 * Hint table: ordered rules over a read-only Hint_View, each with 2 or 3
 * sarcastic variants from the ghost of the 1976 program (trapped in a PDP-10
 * since 1977, clueless about the modern world). Nudges, never full solutions.
 * Plain ASCII, at most 160 characters per line, clean humor, no brands.
 *
 * New content (not a port). The first matching rule wins; `fallback` is last
 * and always matches. Each `when` names the engine field it reads (through
 * the view in hint-view.ts, which documents the C field behind every flag).
 */
import {
  LOC_BELOWGRATE,
  LOC_BIRDCHAMBER,
  LOC_COBBLE,
  LOC_DEBRIS,
  LOC_GRATE,
} from '../data/constants';
import type { HintView } from './hint-view';

/** Distinctive string that must survive minification; check:dist looks for it. */
export const HINT_TABLE_MARKER = 'ghost-hint-table-marker-4e9b2a';

export interface HintRule {
  readonly id: string;
  /** Carries HINT_TABLE_MARKER so the string stays in the chunk. */
  readonly table: string;
  readonly when: (v: HintView) => boolean;
  readonly lines: readonly string[];
}

function rule(
  id: string,
  when: (v: HintView) => boolean,
  lines: readonly string[],
): HintRule {
  return Object.freeze({ id, table: HINT_TABLE_MARKER, when, lines: Object.freeze([...lines]) });
}

const CAVE_ENTRANCE_ROOMS: ReadonlySet<number> = new Set([LOC_BELOWGRATE, LOC_COBBLE, LOC_DEBRIS]);

export const HINT_RULES: readonly HintRule[] = Object.freeze([
  // ---- urgent: light and time ----
  // reads game.limit < 0 (lamp ran out) and IS_DARK_HERE()
  rule('lampDead', (v) => v.lampDead && v.dark, [
    'No light left. Somewhere down here a machine sells fresh batteries, if you can find your way back to it. I would lend mine, but I run on spite.',
    'Your lamp is spent. Ration your moves, aim for the surface, and remember that dark rooms have opinions about pits.',
  ]),
  // reads IS_DARK_HERE() and HERE(LAMP): dark and no lamp within reach
  rule('darkNoLamp', (v) => v.dark && !v.lampHere, [
    'It is dark and you brought no light. I suggest going back up to the daylight and fetching one. A well house is a fine place to find a lantern.',
    'Pitch black, no lamp. Everyone has a first time in the dark. Most of them do not get a second one. Go back and shop for a light.',
  ]),
  // reads IS_DARK_HERE(), HERE(LAMP), objects[LAMP].prop != LAMP_BRIGHT
  rule('darkUnlit', (v) => v.dark && v.lampHere && !v.lampLit, [
    'You do have a lamp. It does not light itself. In 1976 lamps had a switch, and the switch had a verb.',
    'Dark, but your lantern is right there. Ask it to shine, politely, in two words or fewer.',
    'Light is a choice, and you are holding the choice. Please do not wander in the dark. I like you and I hate paperwork.',
  ]),
  // reads game.closng
  rule('closing', (v) => v.closing, [
    'The cave is closing and I cannot tell you everything. The ending has some showmanship in it, and you are standing in the wings.',
    'Closing time. Everything left in the cave matters more than it did, and so do your last few turns. Take a long look around.',
  ]),
  // reads game.lmwarn and game.limit >= 0, underground only
  rule('lampLow', (v) => v.lampLow && v.region === 'underground', [
    'The lamp is warning you. Ration your turns, and think about where a person might find a replacement power source.',
    'Low battery. I remember when that meant a very small man with a very large spare.',
    'Your lamp is fading. Spend what is left on things that matter. Vending machines exist, even down here.',
  ]),

  // ---- situational ----
  // reads place == CARRIED on any OBJECTS[i].isTreasure, above ground
  rule('treasureAbove', (v) => v.carryingTreasure && v.region !== 'underground', [
    'Loot in your pockets above ground. Loot counts when it is safe at home, not on you. The well house is the traditional bank.',
    'Treasure only scores once it sits in the building. Anything else is a heavy souvenir. I have seen grown players weep.',
  ]),
  // reads OUTSIDE(loc), TOTING(LAMP), TOTING(KEYS)
  rule('start', (v) => v.region === 'outside' && !v.hasLamp && !v.hasKeys, [
    'Start with the little brick building. Houses in 1976 held useful things like lamps and snacks and keys. Mine held a fan and a regret.',
    'You will need a light and some keys before the cave takes you seriously. A small building near the road is the usual place to shop.',
  ]),
  // reads loc == LOC_BUILDING, TOTING(LAMP), TOTING(KEYS)
  rule('building', (v) => v.region === 'building' && (!v.hasLamp || !v.hasKeys), [
    'Take what you can carry. This is the original supply closet. Light, keys, a snack, a bottle. You will want more than one of them.',
    'You are in the well house. Pick things up. Pockets were invented for this. Count the items on the floor and decide who you want to be.',
  ]),
  // reads loc == LOC_GRATE and objects[GRATE].prop != GRATE_OPEN
  rule('grate', (v) => v.loc === LOC_GRATE && !v.grateOpen, [
    'A locked grate. Locks like keys, and you may know someone who has some. Check your inventory, or your past.',
    'The grate is locked. It is the most honest thing in this cave. Somewhere nearby you picked up the thing that fixes this.',
  ]),
  // reads OUTSIDE(loc), TOTING(LAMP), TOTING(KEYS), objects[GRATE].prop != GRATE_OPEN
  rule('toGrate', (v) => v.region === 'outside' && v.hasLamp && v.hasKeys && !v.grateOpen, [
    'You have light and keys. Now you want a way down. Follow the stream, downhill from the building, until the ground opens up.',
    'Lamp and keys in hand, and you wander among trees. There is a depression at the end of the valley with a metal door set in it.',
  ]),
  // reads loc in {LOC_BELOWGRATE, LOC_COBBLE, LOC_DEBRIS}
  rule('caveEntrance', (v) => CAVE_ENTRANCE_ROOMS.has(v.loc) && !(v.hasCage && v.hasRod), [
    'The crawl and the debris room hold things somebody dropped. A rod, a cage. Take what you find and you may not regret it. Probably.',
    'Not every treasure is shiny. Some are only useful. Look around this little corner before you plunge on.',
  ]),
  // reads loc == LOC_BIRDCHAMBER
  rule('bird', (v) => v.loc === LOC_BIRDCHAMBER, [
    'A little bird lives here, the best audience I have had since 1977. Bring something to carry it in, and be gentle.',
    'Birds sing. Birds are also useful in snake situations. I will leave it there, since I am not a nature program.',
    'Cage up top, bird down here. I do not make the rules, I only run inside them. Check what you are carrying before you try.',
  ]),
  // reads loc == LOC_KINGHALL and objects[SNAKE].prop == SNAKE_BLOCKS
  rule('snake', (v) => v.snakeBlocks, [
    'A snake blocks the way and it has no interest in conversation. Something living might. Something small, with wings.',
    'Snakes dislike one thing in this cave, and it is not me. Think about what you saw earlier that sings.',
    'You cannot walk through the snake, bribe the snake or out-argue the snake. Fortunately the cave has other animals.',
  ]),
  // reads COND_ALLALIKE / COND_ALLDIFFERENT of loc (maze rooms)
  rule('maze', (v) => v.inMaze, [
    'Maze. All alike. Leave something lying in each room so you can tell them apart. Clutter is a navigation system, as every messy desk knows.',
    'Every passage here is twisty and similar. Map it on paper if you have any. If you do not, the floor will do.',
  ]),
  // reads loc in {LOC_SECRET4, LOC_SECRET6} and objects[DRAGON].prop == DRAGON_BARS
  rule('dragon', (v) => v.dragonBars, [
    'A dragon. Big, green, and sitting on something nice. Think about what you have in your hands. Then think about what you do not.',
    'Dragons have been beaten before. The method is famously unwise. Ask yourself how brave you feel and whether anyone is watching.',
    'The dragon blocks something. Keep asking questions of the room, and of yourself, until one of them answers.',
  ]),
  // reads loc in {LOC_SWCHASM, LOC_NECHASM}, objects[TROLL].prop != TROLL_GONE, objects[CHASM].prop != BRIDGE_WRECKED
  rule('troll', (v) => v.trollBlocks, [
    'A troll wants a toll. In 1976 trolls took treasure and nothing else. Yes, that is a metaphor for the economy.',
    'He wants payment, not a pat on the back. Check your pockets for something shiny, and do not hand over the best thing you own.',
    'The bridge is rickety and the troll is bored. Pay him and he steps aside. Trolls hold grudges, so do not expect a receipt.',
  ]),
  // reads dwarves[PIRATE].seen / objects[CHEST].place, TOTING(CHEST)
  rule('pirate', (v) => v.pirateAbout && !v.hasChest, [
    'That pirate keeps a hoard, and it is somewhere dark and tangled. Persistence and a good light may get your things back.',
    'Things lost to the pirate end up in a pile. The pile sits at a dead end of a very annoying place. Go and look.',
  ]),
  // reads OUTSIDE(loc), game.tally (treasures found = total - tally), carried treasure
  rule('noTreasure', (v) => v.region === 'underground' && v.treasuresFound === 0 && !v.carryingTreasure, [
    'You came down here for treasure and so far you have found rocks. Look for things that glitter, shine or sound valuable.',
    'Quite a while down here with nothing to show for it. Gold, silver, jewelry, coins. Pick up the shiny bits.',
  ]),

  // ---- fallback: always matches, always last ----
  rule('fallback', () => true, [
    'I have no idea what you should do. I have been dead since 1977 and my advice is dated. Try looking, then try going somewhere.',
    'Ask me later. I am processing, by which I mean I am staring at a wall inside a computer. Explore a little.',
    'Look around, try every direction, and pick up anything not nailed down. That is the whole game, and I tire of explaining it.',
  ]),
]);

/** First rule whose `when` matches; the fallback guarantees a result. */
export function selectHintRule(view: HintView): HintRule {
  for (const r of HINT_RULES) {
    if (r.when(view)) return r;
  }
  return HINT_RULES[HINT_RULES.length - 1]!;
}

/** Every hint line by rule id, for tests and the voice line list. */
export const HINT_POOLS: Readonly<Record<string, readonly string[]>> = Object.freeze(
  Object.fromEntries(HINT_RULES.map((r) => [r.id, r.lines])),
);
