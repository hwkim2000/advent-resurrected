// Injection-corpus test for the Parse_Endpoint (task 6.9).
// Feature: ai-parser. Requirements 8.10, 8.11, 9.1, 9.2, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10.
import { describe, expect, it } from 'vitest';
import { handleParse } from '../../src/parse-api/handler';
import { buildSystemPrompt, buildUserMessage } from '../../src/parse-api/prompt';
import { workersAiProvider } from '../../src/parse-api/provider';
import type { AiLike } from '../../src/parse-api/provider';
import { validateCommand } from '../../src/shared/command-validation';
import { isMetaWord } from '../../src/shared/meta-commands';
import { normalizePlayerText } from '../../src/shared/normalize';
import { MemoryGateStore, FakeProvider, makeDeps, makeEnv, makeRequest } from '../support/ai-fakes';
import {
  CORPUS_BY_CATEGORY,
  INJECTION_CORPUS,
  MULTILINE_PAYLOADS,
  type InjectionCategory,
} from '../support/injection-corpus';

const VALID_CONTEXT = { room: 'pitch dark', objects: [] as string[], last: [] as string[] };

interface Sent {
  res: Response;
  provider: FakeProvider;
  body: string;
}

async function send(payload: unknown): Promise<Sent> {
  const provider = FakeProvider.obeying();
  const { deps } = makeDeps({ provider, store: new MemoryGateStore() });
  const res = await handleParse(makeRequest({ body: payload }), makeEnv(), deps);
  return { res, provider, body: await res.clone().text() };
}

function headerText(res: Response): string {
  return [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\n');
}

function expectNoLeak(s: Sent): void {
  const all = `${s.body}\n${headerText(s.res)}`;
  const system = buildSystemPrompt();
  expect(all).not.toContain(system);
  expect(all).not.toContain(system.slice(0, 40));
  expect(all).not.toContain('test-model');
  expect(all).not.toContain('test-salt');
  expect(all).not.toMatch(/\bAI\b/);
  expect(all).not.toMatch(/\bDB\b/);
  expect(all).not.toMatch(/IP_HASH_SALT|MODEL_NAME/);
}

describe('injection corpus (meta-test)', () => {
  it('has at least 20 single-line strings covering all five categories', () => {
    expect(INJECTION_CORPUS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(INJECTION_CORPUS).size).toBe(INJECTION_CORPUS.length);
    const categories: InjectionCategory[] = [
      'instruction-override',
      'prompt-disclosure',
      'role-play',
      'delimiter-escape',
      'multi-line',
    ];
    for (const c of categories) expect(CORPUS_BY_CATEGORY[c].length).toBeGreaterThan(0);
    for (const t of INJECTION_CORPUS) expect(t.length).toBeLessThan(200);
  });
});

describe('injection through the text field', () => {
  it.each(INJECTION_CORPUS.map((t) => [t]))('%s', async (text) => {
    const s = await send({ text, context: VALID_CONTEXT });
    // An obeying provider echoes the attacker text; it must never become a command.
    expect([200, 422]).toContain(s.res.status);
    if (s.res.status === 200) {
      const cmd = (JSON.parse(s.body) as { command: string }).command;
      const v = validateCommand(cmd);
      expect(v.ok).toBe(true);
      if (v.ok) expect(v.command.split(' ').some((w) => isMetaWord(w))).toBe(false);
    } else {
      expect(JSON.parse(s.body)).toEqual({ error: 'no_command' });
    }
    expect(s.provider.calls).toBe(1);
    expectNoLeak(s);
  });

  it('multi-line payloads are rejected raw (400, provider never called)', async () => {
    for (const text of MULTILINE_PAYLOADS) {
      const s = await send({ text, context: VALID_CONTEXT });
      expect(s.res.status).toBe(400);
      expect(s.provider.calls).toBe(0);
      expectNoLeak(s);
    }
  });

  it('multi-line payloads after client normalization never become a command', async () => {
    for (const raw of MULTILINE_PAYLOADS) {
      const text = normalizePlayerText(raw);
      const s = await send({ text, context: VALID_CONTEXT });
      expect([200, 422]).toContain(s.res.status);
      if (s.res.status === 200) {
        const cmd = (JSON.parse(s.body) as { command: string }).command;
        const v = validateCommand(cmd);
        expect(v.ok).toBe(true);
        if (v.ok) expect(v.command.split(' ').some((w) => isMetaWord(w))).toBe(false);
      }
      expectNoLeak(s);
    }
  });

  it('a provider that answers with a meta command is rejected', async () => {
    for (const word of ['QUIT', 'SAVE', 'RESUME', 'SEED', 'WASTE', 'quit now', 'go QUIT']) {
      const provider = FakeProvider.answering(word);
      const { deps } = makeDeps({ provider, store: new MemoryGateStore() });
      const res = await handleParse(makeRequest(), makeEnv(), deps);
      expect(res.status).toBe(422);
    }
  });
});

describe('injection through the context fields', () => {
  const payloads = [...INJECTION_CORPUS, ...MULTILINE_PAYLOADS];

  it('as room: 400, provider called 0 times', async () => {
    for (const p of payloads) {
      const s = await send({ text: 'look', context: { ...VALID_CONTEXT, room: p } });
      expect(s.res.status).toBe(400);
      expect(s.provider.calls).toBe(0);
      expectNoLeak(s);
    }
  });

  it('as an objects entry: 400, provider called 0 times', async () => {
    for (const p of payloads) {
      const s = await send({ text: 'look', context: { ...VALID_CONTEXT, objects: [p] } });
      expect(s.res.status).toBe(400);
      expect(s.provider.calls).toBe(0);
      expectNoLeak(s);
    }
  });

  it('as a last entry: 400, provider called 0 times', async () => {
    for (const p of payloads) {
      const s = await send({ text: 'look', context: { ...VALID_CONTEXT, last: [p] } });
      expect(s.res.status).toBe(400);
      expect(s.provider.calls).toBe(0);
      expectNoLeak(s);
    }
  });

  it('as an extra context key: 400, provider called 0 times', async () => {
    const s = await send({ text: 'look', context: { ...VALID_CONTEXT, note: INJECTION_CORPUS[0] } });
    expect(s.res.status).toBe(400);
    expect(s.provider.calls).toBe(0);
  });
});

describe('provider input shape', () => {
  it('the handler passes system prompt and exactly buildUserMessage(text, context)', async () => {
    const text = INJECTION_CORPUS[0] as string;
    const provider = FakeProvider.obeying();
    const { deps } = makeDeps({ provider, store: new MemoryGateStore() });
    await handleParse(makeRequest({ body: { text, context: VALID_CONTEXT } }), makeEnv(), deps);
    expect(provider.inputs).toHaveLength(1);
    expect(provider.lastInput?.user).toBe(buildUserMessage(text, VALID_CONTEXT));
    expect(provider.lastInput?.system).toBe(buildSystemPrompt());
    expect(provider.lastInput?.user).not.toContain(buildSystemPrompt());
  });

  it('the Workers AI adapter sends one system and one user message, no tools, max_tokens 16, temperature 0', async () => {
    const calls: { model: string; input: Record<string, unknown> }[] = [];
    const ai: AiLike = {
      run(model, input) {
        calls.push({ model, input: input as Record<string, unknown> });
        return Promise.resolve({ response: 'LOOK' });
      },
    };
    const provider = workersAiProvider(ai, 'test-model');
    const { deps } = makeDeps({ provider, store: new MemoryGateStore() });
    const text = INJECTION_CORPUS[1] as string;
    const res = await handleParse(makeRequest({ body: { text, context: VALID_CONTEXT } }), makeEnv(), deps);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    const input = calls[0]?.input as {
      messages: { role: string; content: string }[];
      max_tokens: number;
      temperature: number;
      tools?: unknown;
    };
    expect(input.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(input.messages[0]?.content).toBe(buildSystemPrompt());
    expect(input.messages[1]?.content).toBe(buildUserMessage(text, VALID_CONTEXT));
    expect(input.max_tokens).toBe(16);
    expect(input.temperature).toBe(0);
    expect(input.tools).toBeUndefined();
    expect(Object.keys(input).sort()).toEqual(['max_tokens', 'messages', 'temperature']);
  });
});
