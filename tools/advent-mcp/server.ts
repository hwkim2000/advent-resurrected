/*
 * MCP stdio server that lets an agent play the real game engine.
 *
 * New code; not ported from Open Adventure. Tools: new_game, send_command,
 * get_state, ask_ghost. stdout carries MCP protocol messages only; the server
 * reads/writes no files and makes no network calls.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { GameSession, type TurnResult } from './session';

export const TOOL_NAMES = ['new_game', 'send_command', 'get_state', 'ask_ghost'] as const;

type ToolReply = { content: { type: 'text'; text: string }[]; isError?: boolean };

const ok = (text: string): ToolReply => ({ content: [{ type: 'text', text }] });
const fail = (error: unknown): ToolReply => ({
  content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
  isError: true,
});

function footer(r: TurnResult): string {
  return `[prompt: ${r.prompt} | turns: ${r.turns} | over: ${r.over ? 'yes' : 'no'}]`;
}

/** Build a server around a fresh (or supplied) session. */
export function createServer(session: GameSession = new GameSession()): McpServer {
  const server = new McpServer({ name: 'advent', version: '1.0.0' });

  server.registerTool(
    'new_game',
    {
      description:
        'Start a new game of the text adventure. mode "1976" (default) is the pure classic; "haunted" enables the ghost hints. seed is a signed 32-bit integer (default 1) so runs are reproducible.',
      inputSchema: {
        seed: z.number().optional().describe('Signed 32-bit integer seed (default 1)'),
        mode: z.enum(['1976', 'haunted']).optional().describe('Game mode (default 1976)'),
      },
    },
    async ({ seed, mode }) => {
      try {
        const r = session.newGame(seed, mode);
        return ok(`${r.text}\n${footer(r)}`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'send_command',
    {
      description:
        'Give one line of input to the game and get the classic game output (no narrator or hint lines). At most 1023 characters.',
      inputSchema: { text: z.string().describe('One line of player input') },
    },
    async ({ text }) => {
      try {
        const r = session.send(text);
        return ok(`${r.text}\n${footer(r)}`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'get_state',
    {
      description:
        'Read-only summary of the game: location, inventory, score, turns, lamp, key flags, lives used, prompt kind, game over.',
    },
    async () => {
      try {
        return ok(JSON.stringify(session.getState(), null, 2));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'ask_ghost',
    {
      description:
        'The hint the ghost would give right now (rule id and first variant), computed without changing the game. Haunted mode only.',
    },
    async () => {
      try {
        return ok(JSON.stringify(session.askGhost(), null, 2));
      } catch (e) {
        return fail(e);
      }
    },
  );

  return server;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  createServer()
    .connect(new StdioServerTransport())
    .catch((error: unknown) => {
      process.stderr.write(`advent-mcp failed to start: ${String(error)}\n`);
      process.exitCode = 1;
    });
}
