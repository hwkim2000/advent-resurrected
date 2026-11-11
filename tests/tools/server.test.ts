import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, TOOL_NAMES } from '../../tools/advent-mcp/server';

let client: Client | undefined;

async function connect(): Promise<Client> {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer().connect(b);
  client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(a);
  return client;
}

const text = (r: unknown): string =>
  ((r as { content: { text: string }[] }).content ?? []).map((c) => c.text).join('\n');

afterEach(async () => {
  await client?.close();
  client = undefined;
});

describe('advent MCP server (in-memory)', () => {
  it('lists exactly the five tools', async () => {
    const c = await connect();
    const names = (await c.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([...TOOL_NAMES].sort());
  });

  it('plays a few turns and reports state and ghost', async () => {
    const c = await connect();
    const n = await c.callTool({ name: 'new_game', arguments: { seed: 1, mode: 'haunted' } });
    expect(text(n)).toContain('Would you like instructions');
    expect(text(n)).toContain('[prompt: yesno');
    await c.callTool({ name: 'send_command', arguments: { text: 'no' } });
    const r = await c.callTool({ name: 'send_command', arguments: { text: 'in' } });
    expect(text(r)).toContain('well house');
    expect(text(r)).toContain('[prompt: command | turns: 1 | over: no]');
    const st = JSON.parse(text(await c.callTool({ name: 'get_state', arguments: {} })));
    expect(st.mode).toBe('haunted');
    expect(st.turns).toBe(1);
    const gh = JSON.parse(text(await c.callTool({ name: 'ask_ghost', arguments: {} })));
    expect(gh.ghost).toBe(true);
    expect(typeof gh.hint).toBe('string');
  });

  it('returns tool errors instead of crashing', async () => {
    const c = await connect();
    const noGame = await c.callTool({ name: 'send_command', arguments: { text: 'look' } });
    expect(noGame.isError).toBe(true);
    expect(text(noGame)).toMatch(/new_game/);
    expect((await c.callTool({ name: 'get_state', arguments: {} })).isError).toBe(true);

    const badSeed = await c.callTool({ name: 'new_game', arguments: { seed: 1.5 } });
    expect(badSeed.isError).toBe(true);
    await c.callTool({ name: 'new_game', arguments: {} });
    const long = await c.callTool({ name: 'send_command', arguments: { text: 'x'.repeat(1024) } });
    expect(long.isError).toBe(true);
    expect(text(long)).toMatch(/too long/);

    // The server is still alive afterwards.
    const ok = await c.callTool({ name: 'send_command', arguments: { text: 'no' } });
    expect(ok.isError).toBeFalsy();
  });

  it('ask_ghost explains 1976 mode', async () => {
    const c = await connect();
    await c.callTool({ name: 'new_game', arguments: {} });
    const gh = JSON.parse(text(await c.callTool({ name: 'ask_ghost', arguments: {} })));
    expect(gh.ghost).toBe(false);
  });

  it('send_commands runs a batch in order and matches single sends', async () => {
    const script = ['no', 'in', 'take lamp', 'out', 's'];
    const c = await connect();
    await c.callTool({ name: 'new_game', arguments: { seed: 7 } });
    const r = await c.callTool({ name: 'send_commands', arguments: { commands: script } });
    expect(r.isError).toBeFalsy();
    const out = text(r);
    const summary = out.split('--- final output ---')[0]!.trim().split('\n');
    expect(summary).toHaveLength(script.length);
    expect(summary[1]).toMatch(/^2\. in -> .*building.* \(turn 1\)$/i);
    expect(summary[4]).toMatch(/^5\. s -> .* \(turn 4\)$/);
    const batchState = text(await c.callTool({ name: 'get_state', arguments: {} }));

    // Same script one line at a time gives the same final output and state.
    await c.callTool({ name: 'new_game', arguments: { seed: 7 } });
    let last = '';
    for (const cmd of script) last = text(await c.callTool({ name: 'send_command', arguments: { text: cmd } }));
    expect(out.endsWith(last)).toBe(true);
    expect(text(await c.callTool({ name: 'get_state', arguments: {} }))).toBe(batchState);
  });

  it('send_commands rejects bad batches without running any of them', async () => {
    const c = await connect();
    await c.callTool({ name: 'new_game', arguments: {} });
    const many = await c.callTool({ name: 'send_commands', arguments: { commands: Array(61).fill('look') } });
    expect(many.isError).toBe(true);
    expect(text(many)).toMatch(/at most 60/);
    const empty = await c.callTool({ name: 'send_commands', arguments: { commands: [] } });
    expect(empty.isError).toBe(true);
    const long = await c.callTool({ name: 'send_commands', arguments: { commands: ['no', 'x'.repeat(1024)] } });
    expect(long.isError).toBe(true);
    expect(text(long)).toMatch(/Command 2 too long/);
    // Nothing ran: still at the instructions prompt.
    expect(JSON.parse(text(await c.callTool({ name: 'get_state', arguments: {} }))).prompt).toBe('yesno');
  });

  it('send_commands stops when the game ends', async () => {
    const c = await connect();
    await c.callTool({ name: 'new_game', arguments: {} });
    const r = await c.callTool({ name: 'send_commands', arguments: { commands: ['no', 'quit', 'yes', 'look', 'look'] } });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toMatch(/2 command\(s\) not run/);
    expect(text(r)).toContain('over: yes');
  });
});
