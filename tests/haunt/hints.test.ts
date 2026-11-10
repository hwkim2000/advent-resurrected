import { describe, expect, it } from 'vitest';
import {
  BIRD,
  CAGE,
  CHEST,
  DRAGON,
  DRAGON_BARS,
  GRATE,
  GRATE_OPEN,
  KEYS,
  LAMP,
  LAMP_BRIGHT,
  LOC_BIRDCHAMBER,
  LOC_BUILDING,
  LOC_DEBRIS,
  LOC_GRATE,
  LOC_KINGHALL,
  LOC_NECHASM,
  LOC_SECRET4,
  LOC_START,
  LOC_ALIKE1,
  NDWARVES,
  ROD,
  SNAKE,
  SNAKE_BLOCKS,
  SNAKE_CHASED,
} from '../../src/data/constants';
import { OBJECTS } from '../../src/data/dungeon';
import { cloneState, newGame } from '../../src/engine';
import type { GameState } from '../../src/engine';
import { makeHintView } from '../../src/haunt/hint-view';
import { HINT_POOLS, HINT_RULES, HINT_TABLE_MARKER, selectHintRule } from '../../src/haunt/hints';
import { ALL_POOLS, MAX_LINE_LENGTH, REINCARNATION_COUNTDOWN } from '../../src/haunt/lines';
import { DEFLECTION_LINE } from '../../src/haunt/spoken-word-rule';
import { NUDGE_LINES } from '../../src/haunt/yes-no';
import { CARRIED_PLACE_FOR_TESTS as CARRIED } from './moments-helpers';

const TREASURE = OBJECTS.findIndex((o, i) => i > 0 && o.isTreasure);

/** A fresh game moved to `loc`, with optional edits. */
function at(loc: number, edit: (g: GameState) => void = () => {}): GameState {
  const s = cloneState(newGame(0));
  s.game.loc = loc;
  edit(s);
  return s;
}
const carry = (g: GameState, ...objs: number[]) => {
  for (const o of objs) g.game.objects[o]!.place = CARRIED;
};
const lit = (g: GameState) => {
  carry(g, LAMP);
  g.game.objects[LAMP]!.prop = LAMP_BRIGHT;
};
const ruleOf = (s: GameState) => selectHintRule(makeHintView(s)).id;

describe('hint table text rules', () => {
  const lines = HINT_RULES.flatMap((r) => r.lines.map((l) => [r.id, l] as const));

  it('has 40 to 60 lines, 16 to 20 rules plus fallback, 2 to 3 lines each', () => {
    expect(lines.length).toBeGreaterThanOrEqual(40);
    expect(lines.length).toBeLessThanOrEqual(60);
    expect(HINT_RULES.length - 1).toBeGreaterThanOrEqual(16);
    expect(HINT_RULES.length - 1).toBeLessThanOrEqual(20);
    for (const r of HINT_RULES) {
      expect(r.lines.length, r.id).toBeGreaterThanOrEqual(2);
      expect(r.lines.length, r.id).toBeLessThanOrEqual(3);
    }
    expect(HINT_RULES[HINT_RULES.length - 1]!.lines).toHaveLength(3);
  });

  it('is ASCII, non-empty, at most 160 characters', () => {
    for (const [id, l] of lines) {
      expect(l.length, `${id}: ${l}`).toBeGreaterThan(0);
      expect(l.length, `${id}: ${l}`).toBeLessThanOrEqual(MAX_LINE_LENGTH);
      expect(/^[\x20-\x7e]+$/.test(l), `${id}: ${l}`).toBe(true);
    }
  });

  it('is unique, also against other narrator lines', () => {
    const others = new Set<string>([
      REINCARNATION_COUNTDOWN,
      DEFLECTION_LINE,
      ...NUDGE_LINES,
      ...Object.values(ALL_POOLS).flat(),
    ]);
    const seen = new Set<string>();
    for (const [id, l] of lines) {
      expect(seen.has(l), `duplicate: ${l}`).toBe(false);
      expect(others.has(l), `${id} duplicates a narrator line`).toBe(false);
      seen.add(l);
    }
  });

  it('has no brands or forbidden names', () => {
    const banned = /zork|colossal|google|apple|microsoft|amazon|facebook|twitter|netflix|gore|blood/i;
    for (const [id, l] of lines) expect(banned.test(l), `${id}: ${l}`).toBe(false);
  });

  it('rule ids are unique and HINT_POOLS mirrors the rules', () => {
    const ids = HINT_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(HINT_POOLS)).toEqual(ids);
    for (const r of HINT_RULES) expect(HINT_POOLS[r.id]).toEqual(r.lines);
  });

  it('carries the marker on every rule', () => {
    expect(HINT_TABLE_MARKER).toBe('ghost-hint-table-marker-4e9b2a');
    for (const r of HINT_RULES) expect(r.table).toBe(HINT_TABLE_MARKER);
  });
});

describe('hint rules fire on constructed states', () => {
  it('start: outside with nothing', () => expect(ruleOf(at(LOC_START))).toBe('start'));

  it('building: inside without lamp and keys, then falls through once both are carried', () => {
    expect(ruleOf(at(LOC_BUILDING))).toBe('building');
    expect(ruleOf(at(LOC_BUILDING, (g) => carry(g, LAMP, KEYS)))).toBe('fallback');
  });

  it('toGrate: outside with lamp and keys, grate closed', () => {
    expect(ruleOf(at(LOC_START, (g) => carry(g, LAMP, KEYS)))).toBe('toGrate');
  });

  it('grate: at the grate while it is locked; open grate falls through', () => {
    expect(ruleOf(at(LOC_GRATE, (g) => carry(g, LAMP, KEYS)))).toBe('grate');
    expect(
      ruleOf(
        at(LOC_GRATE, (g) => {
          carry(g, LAMP, KEYS);
          g.game.objects[GRATE]!.prop = GRATE_OPEN;
        }),
      ),
    ).toBe('fallback');
  });

  it('caveEntrance: debris room without cage and rod', () => {
    expect(ruleOf(at(LOC_DEBRIS, lit))).toBe('caveEntrance');
    expect(ruleOf(at(LOC_DEBRIS, (g) => { lit(g); carry(g, CAGE, ROD); }))).toBe('noTreasure');
  });

  it('bird: bird chamber', () => {
    expect(ruleOf(at(LOC_BIRDCHAMBER, lit))).toBe('bird');
  });

  it('snake: Hall of the Mountain King while the snake blocks; chased snake does not', () => {
    expect(ruleOf(at(LOC_KINGHALL, (g) => { lit(g); g.game.objects[SNAKE]!.prop = SNAKE_BLOCKS; }))).toBe('snake');
    expect(ruleOf(at(LOC_KINGHALL, (g) => { lit(g); g.game.objects[SNAKE]!.prop = SNAKE_CHASED; }))).not.toBe('snake');
  });

  it('maze: an all-alike room', () => {
    expect(ruleOf(at(LOC_ALIKE1, lit))).toBe('maze');
  });

  it('dragon: dragon room with bars; dead dragon does not', () => {
    expect(ruleOf(at(LOC_SECRET4, (g) => { lit(g); g.game.objects[DRAGON]!.prop = DRAGON_BARS; }))).toBe('dragon');
    expect(ruleOf(at(LOC_SECRET4, (g) => { lit(g); g.game.objects[DRAGON]!.prop = 1; }))).not.toBe('dragon');
  });

  it('troll: chasm side', () => {
    expect(ruleOf(at(LOC_NECHASM, lit))).toBe('troll');
  });

  it('pirate: pirate seen and chest not carried', () => {
    expect(ruleOf(at(LOC_KINGHALL, (g) => { lit(g); g.game.objects[SNAKE]!.prop = SNAKE_CHASED; g.game.dwarves[NDWARVES]!.seen = true; }))).toBe('pirate');
    expect(ruleOf(at(LOC_KINGHALL, (g) => { lit(g); g.game.objects[SNAKE]!.prop = SNAKE_CHASED; g.game.dwarves[NDWARVES]!.seen = true; carry(g, CHEST); }))).not.toBe('pirate');
  });

  it('treasureAbove: carrying treasure outside or in the building', () => {
    expect(ruleOf(at(LOC_START, (g) => carry(g, TREASURE)))).toBe('treasureAbove');
    expect(ruleOf(at(LOC_BUILDING, (g) => carry(g, TREASURE)))).toBe('treasureAbove');
  });

  it('noTreasure: underground, lit, no treasure found', () => {
    expect(ruleOf(at(LOC_KINGHALL, (g) => { lit(g); g.game.objects[SNAKE]!.prop = SNAKE_CHASED; }))).toBe('noTreasure');
    expect(
      ruleOf(
        at(LOC_KINGHALL, (g) => {
          lit(g);
          g.game.objects[SNAKE]!.prop = SNAKE_CHASED;
          carry(g, TREASURE);
          g.game.tally -= 1;
        }),
      ),
    ).toBe('fallback');
  });

  it('dark rules: no lamp, lamp off, lamp dead', () => {
    expect(ruleOf(at(LOC_DEBRIS))).toBe('darkNoLamp');
    expect(ruleOf(at(LOC_DEBRIS, (g) => carry(g, LAMP)))).toBe('darkUnlit');
    expect(ruleOf(at(LOC_DEBRIS, (g) => { carry(g, LAMP); g.game.limit = -1; }))).toBe('lampDead');
  });

  it('lampLow: warned but still burning, underground and lit', () => {
    expect(ruleOf(at(LOC_KINGHALL, (g) => { lit(g); g.game.lmwarn = true; g.game.limit = 20; g.game.objects[SNAKE]!.prop = SNAKE_BLOCKS; }))).toBe('lampLow');
  });

  it('closing', () => {
    expect(ruleOf(at(LOC_KINGHALL, (g) => { lit(g); g.game.closng = true; }))).toBe('closing');
  });

  it('fallback matches everywhere else', () => {
    expect(ruleOf(at(LOC_BIRDCHAMBER, (g) => { lit(g); g.game.tally -= 1; }))).toBe('bird');
    const last = HINT_RULES[HINT_RULES.length - 1]!;
    expect(last.id).toBe('fallback');
    expect(last.when(makeHintView(at(LOC_START)))).toBe(true);
    expect(last.when(makeHintView(at(LOC_ALIKE1)))).toBe(true);
  });
});

describe('hint rule ordering', () => {
  it('dead lamp beats bird chamber and maze', () => {
    expect(ruleOf(at(LOC_BIRDCHAMBER, (g) => { carry(g, LAMP); g.game.limit = -1; }))).toBe('lampDead');
  });

  it('dark beats location rules', () => {
    expect(ruleOf(at(LOC_ALIKE1))).toBe('darkNoLamp');
  });

  it('closing beats lampLow and location rules', () => {
    expect(
      ruleOf(at(LOC_BIRDCHAMBER, (g) => { lit(g); g.game.closng = true; g.game.lmwarn = true; g.game.limit = 10; })),
    ).toBe('closing');
  });

  it('lampLow beats location rules', () => {
    expect(ruleOf(at(LOC_BIRDCHAMBER, (g) => { lit(g); g.game.lmwarn = true; g.game.limit = 10; }))).toBe('lampLow');
  });

  it('treasureAbove beats building', () => {
    expect(ruleOf(at(LOC_BUILDING, (g) => carry(g, TREASURE)))).toBe('treasureAbove');
  });

  it('snake beats pirate and noTreasure', () => {
    expect(
      ruleOf(at(LOC_KINGHALL, (g) => { lit(g); g.game.objects[SNAKE]!.prop = SNAKE_BLOCKS; g.game.dwarves[NDWARVES]!.seen = true; })),
    ).toBe('snake');
  });

  it('bird beats pirate', () => {
    expect(ruleOf(at(LOC_BIRDCHAMBER, (g) => { lit(g); g.game.dwarves[NDWARVES]!.seen = true; carry(g, BIRD); }))).toBe('bird');
  });
});

describe('hint view', () => {
  it('is pure: does not mutate the state', () => {
    const s = at(LOC_KINGHALL, (g) => { lit(g); g.game.dwarves[NDWARVES]!.seen = true; carry(g, TREASURE); });
    const before = JSON.stringify(s);
    const lcg = s.game.lcg_x;
    const v1 = makeHintView(s);
    selectHintRule(v1);
    const v2 = makeHintView(s);
    expect(JSON.stringify(s)).toBe(before);
    expect(s.game.lcg_x).toBe(lcg);
    expect(v2).toEqual(v1);
  });

  it('classifies regions', () => {
    expect(makeHintView(at(LOC_START)).region).toBe('outside');
    expect(makeHintView(at(LOC_BUILDING)).region).toBe('building');
    expect(makeHintView(at(LOC_DEBRIS)).region).toBe('underground');
  });
});
