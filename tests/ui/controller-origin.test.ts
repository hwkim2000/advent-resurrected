// Task 5.9: controller origin example tests.
// Validates: Requirements 8.9, 13.1, 13.2, 13.5, 13.6, 13.9
import { describe, expect, it } from 'vitest';
import { newGame, start, step } from '../../src/engine/index';
import type { Env } from '../../src/engine/index';
import { originalTextOf } from '../../src/ui/event-render';
import type { GateResult } from '../../src/ui/extension-hooks';
import { RESOLUTION_WATCHDOG_MS } from '../../src/ui/game-controller';
import type { InputOrigin } from '../../src/ui/types';
import { ScriptedResolver, makeController as makeRaw } from './support/fakes';
import type { MakeControllerOptions } from './support/fakes';

const allow = (): GateResult => ({ kind: 'allow' });
/** A fresh game opens on the instructions yes/no prompt; answer it so the prompt is a command. */
function makeController(opts: MakeControllerOptions = {}, reset: () => void = () => undefined) {
  const made = makeRaw(opts);
  made.controller.submit('no');
  reset();
  return made;
}
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/** Gate that records (text, origin) for every call. */
function recordingGate() {
  const seen: { text: string; origin: InputOrigin }[] = [];
  return {
    seen,
    gate: (text: string, origin: InputOrigin): GateResult => {
      seen.push({ text, origin });
      return allow();
    },
  };
}

describe('controller input origin', () => {
  it('submit defaults to typed', () => {
    const rec = recordingGate();
    const { controller } = makeController({ gates: [rec.gate] }, () => (rec.seen.length = 0));
    controller.submit('look');
    expect(rec.seen).toEqual([{ text: 'look', origin: 'typed' }]);
  });

  it('any origin value other than spoken becomes typed', () => {
    const rec = recordingGate();
    const { controller } = makeController({ gates: [rec.gate] }, () => (rec.seen.length = 0));
    for (const bad of ['SPOKEN', 'voice', '', 'typed', undefined, null, 1]) {
      controller.submit('look', bad as unknown as InputOrigin);
    }
    expect(rec.seen).toHaveLength(7);
    expect(rec.seen.every((s) => s.origin === 'typed')).toBe(true);
  });

  it('a gate sees spoken for spoken lines and typed for typed ones', () => {
    const rec = recordingGate();
    const { controller } = makeController({ gates: [rec.gate] }, () => (rec.seen.length = 0));
    controller.submit('look', 'spoken');
    controller.submit('look', 'typed');
    expect(rec.seen.map((s) => s.origin)).toEqual(['spoken', 'typed']);
  });

  it('ResolveContext.origin is set for needsTranslation and translate', async () => {
    const resolver = new ScriptedResolver();
    resolver.needs = () => true;
    const { controller } = makeController({ resolver }, () => undefined);
    controller.submit('go inside', 'spoken');
    await flush();
    controller.submit('go inside');
    await flush();
    controller.submit('go inside', 'bogus' as unknown as InputOrigin);
    await flush();
    expect(resolver.needsCalls.map((c) => c.ctx.origin)).toEqual(['spoken', 'typed', 'typed']);
    expect(resolver.translateCalls.map((c) => c.ctx.origin)).toEqual(['spoken', 'typed', 'typed']);
  });

  it('runs the gate on the plain path', () => {
    const rec = recordingGate();
    const { controller } = makeController({ gates: [rec.gate] }, () => (rec.seen.length = 0));
    controller.submit('look', 'spoken');
    expect(rec.seen).toEqual([{ text: 'look', origin: 'spoken' }]);
  });

  it('runs the gate on the AI translated path, with the translated command', async () => {
    const rec = recordingGate();
    const resolver = new ScriptedResolver();
    resolver.needs = () => true;
    resolver.outcome = () => ({ kind: 'translated', command: 'LOOK' });
    const { controller } = makeController({ gates: [rec.gate], resolver }, () => (rec.seen.length = 0));
    controller.submit('what is here', 'spoken');
    await flush();
    expect(rec.seen).toEqual([{ text: 'LOOK', origin: 'spoken' }]);
  });

  it('runs the gate on the AI failed path (fallback and rejection)', async () => {
    const rec = recordingGate();
    const resolver = new ScriptedResolver();
    resolver.needs = () => true;
    resolver.outcome = () => ({ kind: 'fallback', notice: false });
    const { controller } = makeController({ gates: [rec.gate], resolver }, () => (rec.seen.length = 0));
    controller.submit('what is here', 'spoken');
    await flush();
    resolver.outcome = () => Promise.reject(new Error('boom'));
    controller.submit('and here', 'typed');
    await flush();
    expect(rec.seen).toEqual([
      { text: 'what is here', origin: 'spoken' },
      { text: 'and here', origin: 'typed' },
    ]);
  });

  it('runs the gate on the watchdog path', () => {
    const rec = recordingGate();
    const resolver = new ScriptedResolver();
    resolver.needs = () => true;
    resolver.outcome = () => new Promise(() => undefined);
    const { controller } = makeController({ gates: [rec.gate], resolver }, () => (rec.seen.length = 0));
    controller.submit('hang forever', 'spoken');
    expect(rec.seen).toEqual([]);
    controller.tick(1000);
    controller.tick(1000 + RESOLUTION_WATCHDOG_MS);
    expect(rec.seen).toEqual([{ text: 'hang forever', origin: 'spoken' }]);
  });

  it('does not run the gate on the NEW line after the game is over', () => {
    const rec = recordingGate();
    const { controller } = makeController({ gates: [rec.gate] }, () => (rec.seen.length = 0));
    controller.submit('quit');
    controller.submit('yes');
    expect(controller.phase).toBe('over');
    const before = rec.seen.length;
    controller.submit('new', 'spoken');
    expect(rec.seen).toHaveLength(before);
    expect(controller.phase).toBe('ready');
  });

  it('promptKind is undefined before a game', () => {
    const { controller } = makeRaw({ boot: false });
    expect(controller.promptKind).toBeUndefined();
    controller.startBoot();
    controller.tick(0);
    controller.skip();
    expect(controller.promptKind).toBe('yesno');
  });

  it('delivers an interleaved typed and spoken line in submission order', async () => {
    const rec = recordingGate();
    const resolver = new ScriptedResolver();
    resolver.needs = (line) => line === 'slow';
    const { controller } = makeController({ gates: [rec.gate], resolver }, () => (rec.seen.length = 0));
    controller.submit('slow', 'spoken'); // resolving asynchronously
    controller.submit('look', 'typed');
    controller.submit('look', 'spoken');
    controller.submit('look', 'typed');
    await flush();
    expect(rec.seen).toEqual([
      { text: 'slow', origin: 'spoken' },
      { text: 'look', origin: 'typed' },
      { text: 'look', origin: 'spoken' },
      { text: 'look', origin: 'typed' },
    ]);
  });

  it('with no gate and no layer the transcript is the engine output, whatever the origin', () => {
    const env: Env = { storage: { read: () => undefined, write: () => true } };
    let state = start(newGame(5), env).state;
    let expected = '';
    const first = start(newGame(5), env);
    expected += originalTextOf(first.events);
    const commands = ['no', 'look', 'in', 'get keys', 'xyzzy'];
    for (const c of commands) {
      const r = step(state, c, env);
      state = r.state;
      expected += originalTextOf(r.events);
    }
    const { controller, view } = makeRaw({ seed: 5 });
    commands.forEach((c, i) => controller.submit(c, i % 2 === 0 ? 'spoken' : 'typed'));
    expect(view.textOfKind('original')).toBe(expected);
    expect(view.textOfKind('narrator')).toBe('');
    expect(view.textOfKind('translation')).toBe('');
  });
});
