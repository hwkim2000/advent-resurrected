/*
 * Command-line runner for the game engine (task 11.1).
 *
 * Usage: tsx cli/advent-cli.ts [--seed N] [--oldstyle] < input
 *
 * This file lives outside src/engine/ so the engine keeps no Node dependency.
 * It drives the engine's public API (start / step / endOfInput / render).
 *
 * Ported engine: Open Adventure (https://gitlab.com/esr/open-adventure).
 * SPDX-FileCopyrightText: Copyright Eric S. Raymond <esr@thyrsus.com>
 * SPDX-License-Identifier: BSD-2-Clause
 *
 * BSD 2-Clause License. Redistribution and use in source and binary forms, with
 * or without modification, are permitted provided that the following conditions
 * are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice,
 *    this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  endOfInput,
  newGame,
  render,
  start,
  step,
  type Env,
  type GameState,
  type OutputEvent,
  type Storage,
} from '../src/engine/index';

const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

/**
 * Parse a --seed argument: optional '-', decimal digits only, signed 32-bit
 * range. Returns null when the text is not a valid seed.
 */
export function parseSeedArg(text: string): number | null {
  if (!/^-?\d+$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isSafeInteger(value)) return null;
  if (value < INT32_MIN || value > INT32_MAX) return null;
  return value === 0 ? 0 : value; // normalise -0
}

/** Storage backed by files on disk. Failures are reported via the interface. */
export class FileStorage implements Storage {
  read(name: string): string | undefined {
    try {
      return readFileSync(name, 'utf8');
    } catch {
      return undefined;
    }
  }

  write(name: string, data: string): boolean {
    try {
      writeFileSync(name, data, 'utf8');
      return true;
    } catch {
      return false;
    }
  }
}

export interface CliStreams {
  stdin: AsyncIterable<string | Uint8Array>;
  stdout: { write(text: string): unknown };
  stderr: { write(text: string): unknown };
  isTTY?: boolean;
}

interface CliArgs {
  seed: number | null;
  oldstyle: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs | string {
  let seed: number | null = null;
  let oldstyle = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--oldstyle' || arg === '-o') {
      oldstyle = true;
    } else if (arg === '--seed' || arg.startsWith('--seed=')) {
      const text = arg === '--seed' ? argv[++i] : arg.slice('--seed='.length);
      const parsed = text === undefined ? null : parseSeedArg(text);
      if (parsed === null) {
        return `Invalid seed: ${text === undefined ? '(missing)' : JSON.stringify(text)}. The seed must be a 32-bit integer.`;
      }
      seed = parsed;
    } else {
      return `Unknown argument: ${arg}`;
    }
  }
  return { seed, oldstyle };
}

/**
 * Run the CLI. Returns the process exit status (0 on game over or EOF,
 * non-zero on bad arguments or an internal engine error).
 */
export async function runCli(
  argv: readonly string[],
  streams: CliStreams,
  storage: Storage = new FileStorage(),
): Promise<number> {
  const args = parseArgs(argv);
  if (typeof args === 'string') {
    streams.stderr.write(`${args}\n`);
    return 2;
  }

  // Without --seed, pick a fresh one (the CLI may use the clock; the engine may not).
  const seed = args.seed ?? (Date.now() | 0);
  const env: Env = { storage };
  const show = (events: readonly OutputEvent[]): void => {
    const text = render(events as OutputEvent[], { echo: false });
    if (text !== '') streams.stdout.write(text);
  };

  try {
    let state: GameState = newGame(seed, { oldstyle: args.oldstyle });
    let result = start(state, env);
    state = result.state;
    show(result.events);

    const decoder = new TextDecoder();
    let buffer = '';
    const lines: string[] = [];
    let over = state.session.status === 'over';

    const feed = (line: string): void => {
      result = step(state, line, env);
      state = result.state;
      show(result.events);
      over = state.session.status === 'over';
    };

    for await (const chunk of streams.stdin) {
      if (over) break;
      buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
      let nl: number;
      while (!over && (nl = buffer.indexOf('\n')) >= 0) {
        lines.push(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
        feed(lines.pop() as string);
      }
      if (!over && streams.isTTY) streams.stdout.write('> ');
    }

    if (!over) {
      // getline semantics: a final unterminated line is still a line.
      if (buffer !== '') feed(buffer);
      if (!over) {
        result = endOfInput(state, env);
        state = result.state;
        show(result.events);
      }
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    streams.stderr.write(`Internal engine error: ${message}\n`);
    return 1;
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  runCli(process.argv.slice(2), {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    isTTY: process.stdin.isTTY === true,
  }).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`Internal error: ${String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
