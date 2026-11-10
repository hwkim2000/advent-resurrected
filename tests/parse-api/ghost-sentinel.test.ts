import { describe, expect, it } from 'vitest';
import { handleParse } from '../../src/parse-api/handler';
import { MemoryGateStore, FakeProvider, makeDeps, makeEnv, makeRequest } from '../support/ai-fakes';

const BODY = {
  text: "I'm totally lost",
  context: { room: "You're at end of road.", objects: [] as string[], last: [] as string[] },
};

async function ask(answer: unknown): Promise<{ status: number; json: unknown; calls: number }> {
  const provider = FakeProvider.answering(answer);
  const { deps } = makeDeps({ provider, store: new MemoryGateStore() });
  const res = await handleParse(makeRequest({ body: BODY }), makeEnv(), deps);
  return { status: res.status, json: JSON.parse(await res.text()) as unknown, calls: provider.calls };
}

describe('Worker GHOST sentinel', () => {
  it.each(['GHOST', 'ghost', ' Ghost\n', '\tGHOST  '])('answers 200 {command:GHOST} for %j', async (raw) => {
    const r = await ask(raw);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ command: 'GHOST' });
    expect(r.calls).toBe(1);
  });

  it.each(['NOCOMMAND', 'garbage!!', 'GHOST LAMP', 'GHOSTS', 'the ghost', '"GHOST"', '', 'QUIT'])(
    'still answers 422 for %j',
    async (raw) => {
      const r = await ask(raw);
      expect(r.status).toBe(422);
      expect(r.json).toEqual({ error: 'no_command' });
    },
  );

  it('a non-string provider output is still an upstream error', async () => {
    const r = await ask(42);
    expect(r.status).toBe(502);
  });

  it('normal commands are unchanged', async () => {
    const r = await ask('enter building');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ command: 'ENTER BUILD' });
  });
});
