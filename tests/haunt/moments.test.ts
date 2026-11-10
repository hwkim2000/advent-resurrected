import { describe, expect, it } from 'vitest';
import { CARRIED_PLACE_FOR_TESTS, kindsOf } from './moments-helpers';
import { DRAGON, DRAGON_DEAD, KEYS, NDWARVES } from '../../src/data/constants';
import { OBJECTS } from '../../src/data/dungeon';
import type { OutputEvent } from '../../src/engine';
import { detectMoments } from '../../src/haunt/moments';
import { makeTurn, playLog } from './support';

const TREASURE = OBJECTS.findIndex((o, i) => i > 0 && o.isTreasure);
const text = (t: string): OutputEvent => ({
  type: 'text',
  channel: 'speak',
  blank: false,
  template: null,
  text: t,
});

describe('detectMoments on constructed diffs', () => {
  it('finds a treasure that became carried, not an ordinary object', () => {
    expect(TREASURE).toBeGreaterThan(0);
    const t = makeTurn((g) => {
      g.game.objects[TREASURE]!.place = CARRIED_PLACE_FOR_TESTS;
    });
    expect(kindsOf(detectMoments(t, []))).toEqual(['treasure']);
    const keys = makeTurn((g) => {
      g.game.objects[KEYS]!.place = CARRIED_PLACE_FOR_TESTS;
    });
    expect(detectMoments(keys, [])).toEqual([]);
  });

  it('does not repeat a treasure already carried before the turn', () => {
    const t = makeTurn(() => {}, {
      prepare: (g) => {
        g.game.objects[TREASURE]!.place = CARRIED_PLACE_FOR_TESTS;
      },
    });
    expect(detectMoments(t, [])).toEqual([]);
  });

  it('finds a newly seen dwarf and a newly seen pirate separately', () => {
    const dwarf = makeTurn((g) => {
      g.game.dwarves[1]!.seen = true;
    });
    expect(kindsOf(detectMoments(dwarf, []))).toEqual(['dwarf']);
    const pirate = makeTurn((g) => {
      g.game.dwarves[NDWARVES]!.seen = true;
    });
    expect(kindsOf(detectMoments(pirate, []))).toEqual(['pirate']);
  });

  it('finds the dragon dying once', () => {
    const t = makeTurn((g) => {
      g.game.objects[DRAGON]!.prop = DRAGON_DEAD;
    });
    expect(kindsOf(detectMoments(t, []))).toEqual(['dragon']);
  });

  it('finds the lamp warning and the lamp running out', () => {
    const dim = makeTurn((g) => {
      g.game.lmwarn = true;
    });
    expect(kindsOf(detectMoments(dim, []))).toEqual(['lampDim']);
    const out = makeTurn((g) => {
      g.game.limit = -1;
    }, { prepare: (g) => { g.game.limit = 1; } });
    expect(kindsOf(detectMoments(out, []))).toEqual(['lampOut']);
    const still = makeTurn(() => {}, { prepare: (g) => { g.game.limit = -1; } });
    expect(detectMoments(still, [])).toEqual([]);
  });

  it('finds the maze from the original text, case-insensitively', () => {
    const t = makeTurn();
    const events = [text('You are in a maze of twisty little passages, all alike.')];
    expect(kindsOf(detectMoments(t, events))).toEqual(['maze']);
    expect(detectMoments(t, [text('A quiet room.')])).toEqual([]);
  });

  it('finds going back to the room before the one just left', () => {
    const t = makeTurn(
      (g) => {
        g.game.loc = 7;
        g.game.oldloc = 8;
      },
      { prepare: (g) => { g.game.loc = 8; g.game.oldloc = 7; } },
    );
    expect(kindsOf(detectMoments(t, [{ type: 'room-entered', loc: 7 }]))).toEqual(['backtrack']);
    expect(detectMoments(t, [{ type: 'room-entered', loc: 9 }])).toEqual([]);
  });

  it('groups death causes and carries the count', () => {
    const groups = (
      [['pit', 'fall'], ['bridge', 'fall'], ['dwarf', 'dwarf'], ['nowhere', 'other']] as const
    ).map(([cause, group]) => {
      const m = detectMoments(makeTurn(), [{ type: 'death', cause, count: 2 }]);
      expect(m).toEqual([{ kind: 'death', deathGroup: group, deathCount: 2 }]);
    });
    expect(groups).toHaveLength(4);
  });

  it('tells reincarnation from a farewell by the state after the croak prompt', () => {
    const croak = (g: { session: { pending: unknown } }): void => {
      g.session.pending = { k: 'croak', origin: 'pit', obit: 0 };
    };
    const yes = makeTurn(
      (g) => {
        g.session.pending = { k: 'command' };
        g.session.status = 'running';
      },
      { prepare: croak },
    );
    expect(kindsOf(detectMoments(yes, []))).toEqual(['reincarnated']);
    const no = makeTurn(
      (g) => {
        g.session.status = 'over';
      },
      { prepare: croak },
    );
    expect(kindsOf(detectMoments(no, []))).toEqual(['declined']);
    const unclear = makeTurn(() => {}, { prepare: croak });
    expect(detectMoments(unclear, [])).toEqual([]);
  });

  it('fires spokenXyzzy only for a spoken line with the XYZZY motion word', () => {
    expect(
      kindsOf(detectMoments(makeTurn(() => {}, { line: 'xyzzy', origin: 'spoken' }), [])),
    ).toEqual(['spokenXyzzy']);
    expect(
      kindsOf(detectMoments(makeTurn(() => {}, { line: 'go xyzzy', origin: 'spoken' }), [])),
    ).toEqual(['spokenXyzzy']);
    expect(detectMoments(makeTurn(() => {}, { line: 'xyzzy', origin: 'typed' }), [])).toEqual([]);
    expect(detectMoments(makeTurn(() => {}, { line: 'plugh', origin: 'spoken' }), [])).toEqual([]);
  });

  it('only reports event-based moments at game start (no before state)', () => {
    const t = { ...makeTurn(), before: undefined };
    expect(detectMoments(t, [])).toEqual([]);
    expect(kindsOf(detectMoments(t, [text('all alike')]))).toEqual(['maze']);
  });
});

describe('detectMoments on real engine runs (upstream logs)', () => {
  const seen = (log: string): Set<string> => {
    const kinds = new Set<string>();
    for (const { turn, events } of playLog(log)) {
      for (const m of detectMoments(turn, events)) kinds.add(m.kind);
    }
    return kinds;
  };

  it('birdsnakewake: dragon, maze, treasure, dwarf, pirate, lamp warning', () => {
    const k = seen('birdsnakewake');
    for (const kind of ['dragon', 'maze', 'treasure', 'dwarf', 'lampDim']) {
      expect(k.has(kind), kind).toBe(true);
    }
  });

  it('lampdim2: the lamp runs out', () => {
    expect(seen('lampdim2').has('lampOut')).toBe(true);
  });

  it('pirate_spotted: the pirate shows up', () => {
    expect(seen('pirate_spotted').has('pirate')).toBe(true);
  });

  it('dwarf: a death by dwarf, then a declined offer', () => {
    const deaths = playLog('dwarf')
      .flatMap((t) => detectMoments(t.turn, t.events))
      .filter((m) => m.kind === 'death');
    expect(deaths.length).toBeGreaterThan(0);
    expect(deaths[0]).toMatchObject({ deathGroup: 'dwarf', deathCount: 1 });
  });

  it('death-jump: the fissure jump is an "other" death and declining it is a farewell', () => {
    const deaths = playLog('death-jump')
      .flatMap((t) => detectMoments(t.turn, t.events))
      .filter((m) => m.kind === 'death');
    expect(deaths[0]).toMatchObject({ deathGroup: 'other', deathCount: 1 });
    expect(seen('death-jump').has('declined')).toBe(true);
  });

  it('reincarnate: accepting the offer is a reincarnation', () => {
    expect(seen('reincarnate').has('reincarnated')).toBe(true);
  });

  it('pitfall: a pit death is a fall', () => {
    const deaths = playLog('pitfall')
      .flatMap((t) => detectMoments(t.turn, t.events))
      .filter((m) => m.kind === 'death');
    expect(deaths[0]).toMatchObject({ deathGroup: 'fall' });
  });
});
