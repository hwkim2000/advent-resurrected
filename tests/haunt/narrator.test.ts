import { afterEach, describe, expect, it, vi } from 'vitest';
import { OBJECTS } from '../../src/data/dungeon';
import type { OutputEvent } from '../../src/engine';
import { ALL_POOLS, MAX_LINE_LENGTH, REINCARNATION_COUNTDOWN } from '../../src/haunt/lines';
import { COOLDOWN_TURNS, createNarrator } from '../../src/haunt/narrator';
import { CARRIED_PLACE_FOR_TESTS } from './moments-helpers';
import { makeTurn, playLog } from './support';

afterEach(() => vi.restoreAllMocks());

const TREASURE = OBJECTS.findIndex((o, i) => i > 0 && o.isTreasure);
const treasureTurn = () =>
  makeTurn((g) => {
    g.game.objects[TREASURE]!.place = CARRIED_PLACE_FOR_TESTS;
  });
const dwarfTurn = () =>
  makeTurn((g) => {
    g.game.dwarves[1]!.seen = true;
  });
const quietTurn = () => makeTurn();
const deathEvents = (count: number, cause: 'pit' | 'dwarf' | 'nowhere' = 'pit'): OutputEvent[] => [
  { type: 'death', cause, count },
];

describe('pools and text rules', () => {
  const all = Object.entries(ALL_POOLS);

  it('every pool has at least 3 lines', () => {
    for (const [name, pool] of all) expect(pool.length, name).toBeGreaterThanOrEqual(3);
  });

  it('covers every required moment', () => {
    for (const name of [
      'treasure', 'dwarf', 'pirate', 'dragon', 'lampDim', 'lampOut', 'maze', 'backtrack',
      'deathFall', 'deathDwarf', 'deathOther', 'deathSecond', 'deathThird',
      'reincarnated', 'declined', 'spokenXyzzy',
    ]) {
      expect(ALL_POOLS[name], name).toBeDefined();
    }
  });

  it('all lines are plain ASCII, non-empty, at most 160 characters and unique', () => {
    const seen = new Set<string>();
    for (const [name, pool] of [...all, ['countdown', [REINCARNATION_COUNTDOWN]] as const]) {
      for (const line of pool) {
        expect(line.length, `${name}: ${line}`).toBeGreaterThan(0);
        expect(line.length, `${name}: ${line}`).toBeLessThanOrEqual(MAX_LINE_LENGTH);
        expect(/^[\x20-\x7e]+$/.test(line), `${name}: ${line}`).toBe(true);
        expect(seen.has(line), `duplicate: ${line}`).toBe(false);
        seen.add(line);
      }
    }
  });

  it('has no brands or forbidden names', () => {
    const banned = /zork|colossal|google|apple|microsoft|amazon|facebook|twitter|netflix|gore|blood/i;
    for (const [name, pool] of all) {
      for (const line of pool) expect(banned.test(line), `${name}: ${line}`).toBe(false);
    }
  });
});

describe('narrator firing rules', () => {
  it('stays silent on a quiet turn', () => {
    const n = createNarrator({ seed: 1 });
    expect(n.lines(quietTurn(), [])).toEqual([]);
  });

  it('fires one line for a key moment', () => {
    const n = createNarrator({ seed: 1 });
    const out = n.lines(treasureTurn(), []);
    expect(out).toHaveLength(1);
    expect(ALL_POOLS.treasure).toContain(out[0]);
  });

  it('applies the cooldown to regular moments', () => {
    const n = createNarrator({ seed: 1 });
    expect(n.lines(treasureTurn(), [])).toHaveLength(1); // turn 1
    expect(n.lines(dwarfTurn(), [])).toEqual([]); // turn 2: cooling down
    expect(n.lines(dwarfTurn(), [])).toEqual([]); // turn 3
    expect(COOLDOWN_TURNS).toBe(3);
    expect(n.lines(dwarfTurn(), [])).toHaveLength(1); // turn 4: 3 turns after turn 1
  });

  it('fires each regular kind at most once per life', () => {
    const n = createNarrator({ seed: 1 });
    expect(n.lines(treasureTurn(), [])).toHaveLength(1);
    for (let i = 0; i < 5; i++) n.lines(quietTurn(), []);
    expect(n.lines(treasureTurn(), [])).toEqual([]);
  });

  it('a new life (reincarnation) allows each kind again', () => {
    const n = createNarrator({ seed: 1 });
    expect(n.lines(treasureTurn(), [])).toHaveLength(1);
    const reborn = makeTurn(
      (g) => {
        g.session.pending = { k: 'command' };
      },
      { prepare: (g) => { g.session.pending = { k: 'croak', origin: 'pit', obit: 0 }; } },
    );
    const out = n.lines(reborn, []);
    expect(out[0]).toBe(REINCARNATION_COUNTDOWN);
    expect(ALL_POOLS.reincarnated).toContain(out[1]);
    for (let i = 0; i < 4; i++) n.lines(quietTurn(), []);
    expect(n.lines(treasureTurn(), [])).toHaveLength(1);
  });

  it('death bypasses cooldown and the per-life limit, with escalation for deaths 2 and 3', () => {
    const n = createNarrator({ seed: 1 });
    n.lines(treasureTurn(), []);
    const first = n.lines(quietTurn(), deathEvents(1, 'pit'));
    expect(ALL_POOLS.deathFall).toContain(first[0]);
    const second = n.lines(quietTurn(), deathEvents(2, 'dwarf'));
    expect(ALL_POOLS.deathSecond).toContain(second[0]);
    const third = n.lines(quietTurn(), deathEvents(3, 'nowhere'));
    expect(ALL_POOLS.deathThird).toContain(third[0]);
  });

  it('uses the right pool per death cause group on a first death', () => {
    const n = createNarrator({ seed: 1 });
    expect(ALL_POOLS.deathDwarf).toContain(n.lines(quietTurn(), deathEvents(1, 'dwarf'))[0]);
    expect(ALL_POOLS.deathOther).toContain(n.lines(quietTurn(), deathEvents(1, 'nowhere'))[0]);
  });

  it('a death turn suppresses the regular line for that turn', () => {
    const n = createNarrator({ seed: 1 });
    const out = n.lines(dwarfTurn(), deathEvents(1, 'dwarf'));
    expect(out).toHaveLength(1);
    expect(ALL_POOLS.deathDwarf).toContain(out[0]);
  });

  it('adds a farewell when the croak offer is declined', () => {
    const n = createNarrator({ seed: 1 });
    const declined = makeTurn(
      (g) => {
        g.session.status = 'over';
      },
      { prepare: (g) => { g.session.pending = { k: 'croak', origin: 'pit', obit: 0 }; } },
    );
    expect(ALL_POOLS.declined).toContain(n.lines(declined, [])[0]);
  });

  it('reacts to a spoken XYZZY every time, ignoring the cooldown', () => {
    const n = createNarrator({ seed: 1 });
    n.lines(treasureTurn(), []);
    const say = () => makeTurn(() => {}, { line: 'xyzzy', origin: 'spoken' });
    const a = n.lines(say(), []);
    const b = n.lines(say(), []);
    expect(ALL_POOLS.spokenXyzzy).toContain(a[0]);
    expect(ALL_POOLS.spokenXyzzy).toContain(b[0]);
    expect(b[0]).not.toBe(a[0]); // rotates through the pool
  });

  it('gameStart clears cooldown and per-life limits; reset also clears rotation', () => {
    const n = createNarrator({ seed: 1 });
    const first = n.lines(treasureTurn(), [])[0];
    expect(n.lines(treasureTurn(), [])).toEqual([]);
    n.gameStart();
    const second = n.lines(treasureTurn(), [])[0];
    expect(second).toBeDefined();
    expect(second).not.toBe(first); // rotation kept
    n.reset();
    expect(n.lines(treasureTurn(), [])[0]).toBe(first);
  });
});

describe('narrator determinism', () => {
  const script = () => [
    treasureTurn(), quietTurn(), quietTurn(), dwarfTurn(), quietTurn(), quietTurn(), quietTurn(),
  ];

  function run(seed: number): string[][] {
    const n = createNarrator({ seed });
    return script().map((t, i) => n.lines(t, i === 5 ? deathEvents(1) : []));
  }

  it('equal seeds give equal output', () => {
    expect(run(42)).toEqual(run(42));
  });

  it('different seeds eventually choose different lines', () => {
    const base = JSON.stringify(run(0));
    expect([1, 2, 3, 4, 5, 6, 7, 8].some((s) => JSON.stringify(run(s)) !== base)).toBe(true);
  });

  it('does not use Math.random and does not touch the engine RNG state', () => {
    const rnd = vi.spyOn(Math, 'random');
    const turn = treasureTurn();
    const beforeJson = JSON.stringify(turn.after);
    const lcg = turn.after.game.lcg_x;
    const n = createNarrator({ seed: 5 });
    n.lines(turn, deathEvents(1));
    n.lines(turn, []);
    expect(rnd).not.toHaveBeenCalled();
    expect(turn.after.game.lcg_x).toBe(lcg);
    expect(JSON.stringify(turn.after)).toBe(beforeJson);
  });

  it('on a real run, narrator output is the same twice and never empty-string', () => {
    const play = (): string[] => {
      const n = createNarrator({ seed: 9 });
      const all: string[] = [];
      for (const { turn, events } of playLog('birdsnakewake')) all.push(...n.lines(turn, events));
      return all;
    };
    const a = play();
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(play());
    for (const line of a) expect(line.length).toBeGreaterThan(0);
  });
});
