// ghost-hints task 3.3: the ghost hint gate through the real controller + haunting wiring.
import { describe, expect, it, vi } from 'vitest';
import { serialize } from '../../src/engine/index';
import type { GameState } from '../../src/engine/index';
import { createGameStartFanOut } from '../../src/game-start-fanout';
import { createGhostGate } from '../../src/haunt/ghost-gate';
import { createHaunting } from '../../src/haunt/haunting';
import type { HauntEffectsPort } from '../../src/haunt/haunting';
import { HINT_POOLS } from '../../src/haunt/hints';
import { voiceKey } from '../../src/haunt/voice-lines';
import { createHauntingLoader } from '../../src/haunting-loader';
import type { HauntEffectsModule, HauntingModule } from '../../src/haunting-loader';
import { decodeAutosave } from '../../src/ui/autosave';
import { AUTOSAVE_KEY } from '../../src/ui/save-store';
import { FakeMotion, ScriptedResolver, makeController } from '../ui/support/fakes';
import type { MadeController } from '../ui/support/fakes';

class VoiceEffects implements HauntEffectsPort {
  spoken: { key: string; text: string }[] = [];
  setDim(): void {}
  flashGlitch(): void {}
  reincarnate(): void {}
  reset(): void {}
  speak(item: { key: string; text: string }): void {
    this.spoken.push(item);
  }
  stopSpeaking(): void {}
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function setup(over: { mode?: 'haunted' | '1976'; resolver?: ScriptedResolver } = {}): {
  m: MadeController;
  fx: VoiceEffects;
} {
  const m = makeController({
    mode: over.mode ?? 'haunted',
    ...(over.resolver ? { resolver: over.resolver } : {}),
  });
  const fx = new VoiceEffects();
  createHaunting({
    hooks: m.hooks,
    effects: fx,
    motion: new FakeMotion(false),
    seed: 7,
    getState: () => m.controller.engineState,
  }).gameStart(m.controller.engineState);
  return { m, fx };
}

async function say(m: MadeController, line: string): Promise<void> {
  m.controller.submit(line);
  await flush();
  m.controller.tick(0);
  await flush();
}

/** The game opens with a yes/no question (instructions); answer NO to reach the command prompt. */
async function declineInstructions(m: MadeController): Promise<void> {
  await say(m, 'no');
  expect(m.view.prompt?.kind).toBe('command');
}

const narrator = (m: MadeController): string[] =>
  m.view.blocks.filter((b) => b.kind === 'narrator').map((b) => b.revealed.trim());
const startLines = HINT_POOLS['start']!;
const buildingLines = HINT_POOLS['building']!;
const savedDeflections = (m: MadeController): number =>
  decodeAutosave(m.kv.get(AUTOSAVE_KEY))?.deflections ?? 0;

describe('ghost gate through the controller', () => {
  it.each(['ghost help', 'ghost, where do I go?', "I'm stuck"])(
    'answers %j with one narrator block and never steps the engine',
    async (ask) => {
      const { m } = setup();
      await declineInstructions(m);
      const before = m.controller.engineState as GameState;
      const serialized = serialize(before);
      const { turns, lcg_x } = before.game;
      const autosaveBefore = m.kv.get(AUTOSAVE_KEY);
      const originalBefore = m.view.textOfKind('original');
      const defl = savedDeflections(m);
      await say(m, ask);
      expect(narrator(m)).toHaveLength(1);
      expect(startLines).toContain(narrator(m)[0]);
      const idxEcho = m.view.calls.findIndex(
        (c) => c.method === 'appendInstant' && c.lines.some((l) => l.kind === 'input' && l.text.includes(ask)),
      );
      const idxNarr = m.view.calls.findIndex((c) => c.method === 'beginBlock' && c.block.kind === 'narrator');
      expect(idxEcho).toBeGreaterThanOrEqual(0);
      expect(idxNarr).toBeGreaterThan(idxEcho);
      expect(m.controller.engineState).toBe(before);
      expect(serialize(m.controller.engineState as GameState)).toBe(serialized);
      expect(m.controller.engineState!.game.turns).toBe(turns);
      expect(m.controller.engineState!.game.lcg_x).toBe(lcg_x);
      expect(m.view.textOfKind('original')).toBe(originalBefore);
      expect(savedDeflections(m)).toBe(defl);
      const ui = (s: string | null): unknown => (s === null ? null : JSON.parse(s).ui);
      expect(ui(m.kv.get(AUTOSAVE_KEY))).toEqual(ui(autosaveBefore));
    },
  );

  it('rotates variants on repeated asks and wraps around', async () => {
    const { m } = setup();
      await declineInstructions(m);
    for (let i = 0; i < startLines.length + 1; i++) await say(m, 'ghost help');
    const got = narrator(m);
    expect(got).toHaveLength(startLines.length + 1);
    expect(got.slice(0, startLines.length)).toEqual([...startLines]);
    expect(got[startLines.length]).toBe(startLines[0]);
  });

  it('picks another rule when the situation changes', async () => {
    const { m } = setup();
      await declineInstructions(m);
    await say(m, 'ghost help');
    await say(m, 'in');
    await say(m, 'ghost help');
    const got = narrator(m).filter((t) => startLines.includes(t) || buildingLines.includes(t));
    expect(startLines).toContain(got[0]);
    expect(buildingLines).toContain(got[got.length - 1]);
  });

  it('speaks the hint line with its voice key', async () => {
    const { m, fx } = setup();
    await declineInstructions(m);
    await say(m, 'ghost help');
    const line = narrator(m)[0]!;
    expect(fx.spoken).toEqual([{ key: voiceKey(line), text: line }]);
  });

  it('shows the dimmed translation and the same hint when the resolver returns GHOST', async () => {
    const resolver = new ScriptedResolver();
    resolver.needs = (l) => l === 'any pointers please';
    resolver.outcome = () => ({ kind: 'translated', command: 'GHOST' });
    const { m } = setup({ resolver });
    await declineInstructions(m);
    const before = m.controller.engineState;
    await say(m, 'any pointers please');
    expect(m.view.interpretations).toContain('GHOST');
    expect(narrator(m)).toHaveLength(1);
    expect(startLines).toContain(narrator(m)[0]);
    expect(m.controller.engineState).toBe(before);
  });

  it('HELP and INFO still reach the engine and print the original text', async () => {
    const { m } = setup();
      await declineInstructions(m);
    for (const cmd of ['help', 'info']) {
      const before = m.controller.engineState;
      const text = m.view.textOfKind('original');
      await say(m, cmd);
      expect(m.controller.engineState).not.toBe(before);
      expect(m.view.textOfKind('original').length).toBeGreaterThan(text.length);
    }
    expect(narrator(m).filter((t) => startLines.includes(t))).toEqual([]);
  });

  it('never answers in 1976 mode (hooks are not even installed)', async () => {
    const m = makeController({ mode: '1976' });
    await declineInstructions(m);
    const before = m.controller.engineState;
    await say(m, 'ghost help');
    expect(narrator(m)).toEqual([]);
    expect(m.controller.engineState).not.toBe(before); // the engine took the line
  });

  it('gives the yes/no nudge, not a hint, at a yes/no prompt', async () => {
    const { m } = setup();
    expect(m.view.prompt?.kind).toBe('yesno'); // the opening instructions question
    await say(m, 'ghost help');
    const lines = narrator(m);
    expect(lines).toHaveLength(1);
    expect(Object.values(HINT_POOLS).flat()).not.toContain(lines[0]);
    expect(lines[0]).toMatch(/YES or NO/);
  });

  it('falls through to the engine when the hint code throws', async () => {
    const m = makeController({ mode: 'haunted' });
    createHaunting({
      hooks: m.hooks,
      effects: new VoiceEffects(),
      motion: new FakeMotion(false),
      seed: 7,
      getState: () => {
        throw new Error('boom');
      },
    }).gameStart(m.controller.engineState);
    await declineInstructions(m);
    const before = m.controller.engineState;
    await say(m, 'ghost help');
    expect(narrator(m)).toEqual([]);
    expect(m.controller.engineState).not.toBe(before);
  });

  it('allows when there is no state yet', () => {
    const gate = createGhostGate({ getState: () => undefined });
    expect(gate('ghost help', 'typed', 0, { gameMode: 'haunted', prompt: 'command' })).toEqual({ kind: 'allow' });
  });

  it('is registered before the yes/no gate and disposed with the haunting', async () => {
    const m = makeController({ mode: 'haunted' });
    const h = createHaunting({
      hooks: m.hooks,
      effects: new VoiceEffects(),
      motion: new FakeMotion(false),
      seed: 7,
      getState: () => m.controller.engineState,
    });
    h.gameStart(m.controller.engineState);
    h.dispose();
    await declineInstructions(m);
    const before = m.controller.engineState;
    await say(m, 'ghost help');
    expect(narrator(m)).toEqual([]);
    expect(m.controller.engineState).not.toBe(before);
  });

  it('resets variant counters on a new game start', async () => {
    const m = makeController({ mode: 'haunted' });
    const h = createHaunting({
      hooks: m.hooks,
      effects: new VoiceEffects(),
      motion: new FakeMotion(false),
      seed: 7,
      getState: () => m.controller.engineState,
    });
    h.gameStart(m.controller.engineState);
    await declineInstructions(m);
    await say(m, 'ghost help');
    await say(m, 'ghost help');
    h.gameStart(m.controller.engineState);
    await say(m, 'ghost help');
    const got = narrator(m);
    expect(got[2]).toBe(got[0]);
    expect(got[1]).not.toBe(got[0]);
  });
});

describe('ghost gate through the real loader', () => {
  it('supplies getState from the host', async () => {
    const log = { error: vi.fn() };
    let m: MadeController | undefined;
    const fx = new VoiceEffects();
    const loader = createHauntingLoader({
      getHost: () =>
        m === undefined
          ? undefined
          : {
              hooks: m.hooks,
              motion: new FakeMotion(false),
              get engineState() {
                return m?.controller.engineState;
              },
            },
      log,
      seed: 1,
      loadHaunting: async (): Promise<HauntingModule> => await import('../../src/haunt/haunting'),
      loadEffects: async (): Promise<HauntEffectsModule> => ({
        createHauntEffects: () => ({
          setDim() {},
          flashGlitch() {},
          reincarnate() {},
          reset() {},
          ...({ speak: fx.speak.bind(fx) } as object),
        }),
      }),
    });
    m = makeController({
      mode: 'haunted',
      boot: false,
      onGameStart: createGameStartFanOut([loader], log),
    });
    m.controller.startBoot();
    m.controller.tick(0);
    m.controller.skip();
    await flush();
    await declineInstructions(m);
    await declineInstructions(m);
    const before = m.controller.engineState;
    await say(m, 'ghost help');
    expect(log.error).not.toHaveBeenCalled();
    expect(narrator(m)).toHaveLength(1);
    expect(m.controller.engineState).toBe(before);
  });
});
