/*
 * Demo client: spawns the advent MCP server over real stdio and plays 20 turns.
 *
 * New code; not ported from Open Adventure. Run with `npm run mcp:demo`.
 * The server is launched with process.execPath and `--import tsx` (no shell,
 * no npx), which works the same on Windows and elsewhere; npx is only a
 * fallback if that launch fails.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(here, 'server.ts');
const ROOT = resolve(here, '..', '..');

/** Each step: a game command, or a tool-only probe. */
const PLAN: readonly string[] = [
  'no', // the "would you like instructions?" prompt (not a turn)
  '@ask_ghost',
  'in',
  'take lamp',
  'take keys',
  'take food',
  'take bottle',
  'light lamp',
  '@get_state',
  'out',
  's',
  's',
  's',
  '@ask_ghost',
  'unlock grate',
  'down',
  'w',
  'take cage',
  'w',
  'take rod',
  '@get_state',
  'e',
  'e',
  'up',
  'down',
  '@ask_ghost',
  '@get_state',
];

function textOf(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content.map((c) => c.text ?? '').join('\n');
}

async function connect(
  command: string,
  args: string[],
): Promise<{ client: Client; transport: StdioClientTransport }> {
  const transport = new StdioClientTransport({ command, args, cwd: ROOT, stderr: 'inherit' });
  const client = new Client({ name: 'advent-demo-client', version: '1.0.0' });
  await client.connect(transport);
  return { client, transport };
}

async function main(): Promise<void> {
  const launches: [string, string[]][] = [
    [process.execPath, ['--import', 'tsx', SERVER_PATH]],
    [process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsx', SERVER_PATH]],
  ];
  let conn: Awaited<ReturnType<typeof connect>> | undefined;
  for (const [command, args] of launches) {
    try {
      conn = await connect(command, args);
      console.log(`# server launched with: ${command === process.execPath ? 'node (process.execPath)' : command} ${args[0]}`);
      break;
    } catch (error) {
      console.log(`# launch failed (${command}): ${String(error)}`);
    }
  }
  if (conn === undefined) throw new Error('Could not launch the advent MCP server.');
  const { client } = conn;

  const tools = await client.listTools();
  console.log(`# tools: ${tools.tools.map((t) => t.name).join(', ')}`);

  console.log('\n> new_game seed=1 mode=haunted');
  console.log(textOf(await client.callTool({ name: 'new_game', arguments: { seed: 1, mode: 'haunted' } })));

  let turns = 0;
  for (const step of PLAN) {
    if (step.startsWith('@')) {
      const name = step.slice(1);
      console.log(`\n> [${name}]`);
      console.log(textOf(await client.callTool({ name, arguments: {} })));
    } else {
      console.log(`\n> ${step}`);
      const r = await client.callTool({ name: 'send_command', arguments: { text: step } });
      console.log(textOf(r));
      if (r.isError === true) throw new Error('Unexpected tool error.');
      turns += 1;
    }
  }
  console.log(`\n# ${turns} send_command calls done`);
  await client.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
