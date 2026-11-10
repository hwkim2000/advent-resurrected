// Feature: voice-input, Property 22: Typed and spoken lines of the same text are equivalent
// **Validates: Requirements 8.5, 8.7, 11.5, 13.2, 18.15**
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { HISTORY_KEY } from '../../../src/ui/save-store';
import type { InputOrigin } from '../../../src/ui/types';
import { createVoiceLayer } from '../../../src/voice/session-controller';
import type { DetectEnv } from '../../../src/voice/detect';
import { FakeScheduler } from '../../voice/support/fake-scheduler';
import { createFakeProviderFactory } from '../../voice/support/fake-provider';
import { VOICE_SEED } from '../../voice/support/pbt';
import { ScriptedResolver, makeController } from '../support/fakes';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/** Sentences the scripted resolver translates, and the command each becomes. */
const SENTENCES: Readonly<Record<string, string>> = {
  "i'll go inside": 'ENTER BUILDING',
  'please pick up the keys': 'GET KEYS',
  'what is around me': 'LOOK',
  'turn on the lamp': 'LAMP ON',
  'let me look around': 'LOOK',
  'walk to the south': 'SOUTH',
  'drop everything': 'DROP ALL',
  'go back outside': 'OUT',
};

/** Classic commands (no Meta command, no Magic_Word). */
const CLASSIC = [
  'look',
  'in',
  'out',
  'get keys',
  'take lamp',
  'inventory',
  'north',
  'n',
  'enter building',
  'go west',
  'drop keys',
  'unlock grate',
  'on lamp',
  'get food',
  'east',
  'xyzzyx',
  'plugx',
  'get',
  'frobnicate widget',
  'score',
  'help',
  'LOOK',
];

const SAMPLE: readonly string[] = [...CLASSIC, ...Object.keys(SENTENCES)];

/** Reachable states: command prefixes typed before the line under test. */
const PREFIXES: readonly (readonly string[])[] = [
  [],
  ['in'],
  ['in', 'get keys', 'get lamp'],
  ['in', 'get lamp', 'on lamp', 'out', 'south'],
  ['xyzzyx', 'look', 'in', 'west'],
];

function scripted(): ScriptedResolver {
  const r = new ScriptedResolver();
  r.needs = (line) => Object.hasOwn(SENTENCES, line.trim().toLowerCase());
  r.outcome = (line) => ({ kind: 'translated', command: SENTENCES[line.trim().toLowerCase()] ?? line });
  return r;
}

async function run(line: string, origin: InputOrigin, seed: number, prefix: readonly string[]) {
  const resolver = scripted();
  const made = makeController({ seed, resolver });
  made.controller.submit('no'); // the instructions prompt
  await flush();
  for (const p of prefix) {
    made.controller.submit(p);
    await flush();
  }
  const before = {
    needs: resolver.needsCalls.length,
    translate: resolver.translateCalls.length,
    blocks: made.view.blocks.length,
  };
  made.controller.submit(line, origin);
  await flush();
  made.controller.tick(100000);
  const strip = (c: { line: string; ctx: Readonly<Record<string, unknown>> }) => {
    const { origin: _o, ...rest } = c.ctx;
    return { line: c.line, ctx: rest };
  };
  return {
    original: made.view.textOfKind('original'),
    translation: made.view.textOfKind('translation'),
    interpretations: [...made.view.interpretations],
    // Queue order: the order the resolver saw lines, and the order blocks were revealed.
    needs: resolver.needsCalls.slice(before.needs).map(strip),
    translate: resolver.translateCalls.slice(before.translate).map(strip),
    accepted: [...resolver.acceptedLines],
    blocks: made.view.blocks.slice(before.blocks).map((b) => ({ kind: b.kind, text: b.text })),
    history: made.kv.get(HISTORY_KEY),
  };
}

describe('Property 22: typed and spoken lines of the same text are equivalent', () => {
  it('the sample has at least 20 lines and no Meta command or Magic_Word', () => {
    expect(SAMPLE.length).toBeGreaterThanOrEqual(20);
    const forbidden = /^(quit|save|resume|seed|waste|suspend|pause|restart|xyzzy|plugh|plover|fee|fie|foe|foo)\b/i;
    for (const s of SAMPLE) expect(s).not.toMatch(forbidden);
  });

  it('spoken and typed submissions give identical output, translation, queue order and history', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...SAMPLE),
        fc.integer({ min: 1, max: 5000 }),
        fc.constantFrom(...PREFIXES),
        async (line, seed, prefix) => {
          const spoken = await run(line, 'spoken', seed, prefix);
          const typed = await run(line, 'typed', seed, prefix);
          expect(spoken).toEqual(typed);
        },
      ),
      { numRuns: 100, seed: VOICE_SEED, verbose: 1 },
    );
  });

  it('every sample line also holds from the same fixed state', async () => {
    for (const line of SAMPLE) {
      expect(await run(line, 'spoken', 7, ['in'])).toEqual(await run(line, 'typed', 7, ['in']));
    }
  });

  it('translated sentences really reach the resolver and print a Translation_Line', async () => {
    const r = await run("I'll go inside", 'spoken', 3, []);
    expect(r.translate).toHaveLength(1);
    expect(r.translation.length).toBeGreaterThan(0);
  });

  it('one utterance "fee fie foe foo" equals four typed lines, with zero resolver requests', async () => {
    const seed = 11;

    // Typed: fee, fie, foe, foo.
    const typedResolver = scripted();
    const typed = makeController({ seed, resolver: typedResolver });
    typed.controller.submit('no');
    for (const w of ['fee', 'fie', 'foe', 'foo']) {
      typed.controller.submit(w);
      await flush();
    }

    // Spoken: one utterance through the real voice layer with the fake provider.
    const spokenResolver = scripted();
    const spoken = makeController({ seed, resolver: spokenResolver });
    spoken.controller.submit('no');
    const sched = new FakeScheduler();
    const fp = createFakeProviderFactory();
    const env: DetectEnv = {
      isSecureContext: true,
      hasRecognition: () => true,
      probe: () => {},
      log: () => {},
    };
    const submitted: { line: string; origin: InputOrigin }[] = [];
    const host = {
      submit: (line: string, origin: InputOrigin) => {
        submitted.push({ line, origin });
        spoken.controller.submit(line, origin);
      },
      get promptKind() {
        return spoken.controller.promptKind;
      },
      get phase() {
        return spoken.controller.phase as never;
      },
      get gameMode() {
        return spoken.controller.gameMode;
      },
      log: spoken.log,
    };
    const layer = createVoiceLayer({ host, createProvider: fp.factory, scheduler: sched, env });
    layer.gameStart('haunted');
    layer.port.dispatch({ type: 'button-activate', via: 'touch' });
    const provider = fp.provider;
    if (provider === undefined) throw new Error('provider was never built');
    provider.emitStart();
    provider.emitFinal(['fee fie foe foo']);
    provider.emitEnd();
    await flush();

    expect(submitted).toHaveLength(4);
    expect(submitted.every((s) => s.origin === 'spoken')).toBe(true);
    expect(spoken.view.textOfKind('original')).toBe(typed.view.textOfKind('original'));
    expect(spoken.view.textOfKind('original').length).toBeGreaterThan(0);
    expect(spokenResolver.translateCalls).toHaveLength(0);
    expect(typedResolver.translateCalls).toHaveLength(0);
  });
});
