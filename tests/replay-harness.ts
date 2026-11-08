/*
 * Replay_Harness: reimplements the upstream test harness
 * (reference/open-adventure/tests/Makefile: `advent $OPTS < NAME.log`) in TypeScript.
 *
 * Reads only from reference/ (never writes there).
 *
 * Ported from Open Adventure (https://gitlab.com/esr/open-adventure).
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

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { endOfInput, newGame, render, start, step } from '../src/engine/index';
import type { Env, GameState, OutputEvent, Storage } from '../src/engine/index';

/** Directory holding the upstream .log / .chk files. */
export const UPSTREAM_TESTS_DIR = fileURLToPath(
  new URL('../reference/open-adventure/tests/', import.meta.url),
);

/**
 * The upstream harness has no fixed seed (init.c seeds from time()); logs that
 * need determinism use the in-game SEED verb. We use one fixed default (C-8).
 */
export const HARNESS_DEFAULT_SEED = 0;

/**
 * Logs that read a fixture written by another log. The dependency is replayed
 * first, into the same storage, with its output discarded. Mirrors the
 * alphabetical run order of the upstream Makefile.
 */
export const FIXTURE_DEPENDENCIES: Readonly<Record<string, readonly string[]>> = {
  'saveresume.2': ['saveresume.1'],
  'saveresume.4': ['saveresume.3'],
  saveresumeopt: ['saveresume.1'],
};

/** Static fixtures: `../main.o` (used by badmagic.log) is a non-save binary file. */
export const STATIC_FIXTURES: Readonly<Record<string, string>> = {
  '../main.o': '\x7fELF\x02\x01\x01\x00 not an Open Adventure save file \x00\xff\xfe\x01\x02',
};

/** Parsed command-line options (C: getopt("dl:or:") in main.c). */
export interface HarnessOptions {
  debug: boolean;
  oldstyle: boolean;
  /** `-l NAME`: write-only log file upstream, so it has no effect on stdout. */
  logFile: string | undefined;
  /** `-r NAME`: restore file passed to start. */
  restoreFile: string | undefined;
  /** Non-option arguments (script files); unused by the engine. */
  scripts: string[];
}

/** Split a command line the way a POSIX shell would (quotes and backslashes). */
export function shellSplit(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inWord = false;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (quote === "'") {
      if (ch === "'") quote = null;
      else cur += ch;
    } else if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === '\\' && i + 1 < text.length && '"\\$`'.includes(text[i + 1] as string)) {
        cur += text[++i];
      } else cur += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      inWord = true;
    } else if (ch === '\\' && i + 1 < text.length) {
      cur += text[++i];
      inWord = true;
    } else if (/\s/.test(ch)) {
      if (inWord) {
        out.push(cur);
        cur = '';
        inWord = false;
      }
    } else {
      cur += ch;
      inWord = true;
    }
  }
  if (quote !== null) throw new Error('unterminated quote in #options line');
  if (inWord) out.push(cur);
  return out;
}

/**
 * Collect the text after the first `#options:` on every line that contains it
 * (sed -n /#options:/s///p), shell-split it, and parse getopt("dl:or:").
 */
export function parseOptions(logText: string): HarnessOptions {
  const words: string[] = [];
  for (const line of logText.split('\n')) {
    const idx = line.indexOf('#options:');
    if (idx < 0) continue;
    words.push(...shellSplit(line.slice(idx + '#options:'.length)));
  }
  const opts: HarnessOptions = {
    debug: false,
    oldstyle: false,
    logFile: undefined,
    restoreFile: undefined,
    scripts: [],
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as string;
    if (w === '--') {
      opts.scripts.push(...words.slice(i + 1));
      break;
    }
    if (w.length < 2 || w[0] !== '-') {
      opts.scripts.push(w); // glibc getopt permutes non-options to the end
      continue;
    }
    for (let j = 1; j < w.length; j++) {
      const flag = w[j] as string;
      if (flag === 'd') opts.debug = true;
      else if (flag === 'o') opts.oldstyle = true;
      else if (flag === 'l' || flag === 'r') {
        let arg: string | undefined;
        if (j + 1 < w.length) arg = w.slice(j + 1);
        else arg = words[++i];
        if (arg === undefined) throw new Error(`option -${flag} requires an argument`);
        // -l: write-only log file upstream; accepted and ignored here.
        if (flag === 'l') opts.logFile = arg;
        else opts.restoreFile = arg;
        break;
      } else throw new Error(`unknown option -${flag} in #options line`);
    }
  }
  return opts;
}

/**
 * Split a log into input lines with getline semantics: split on LF; a trailing
 * LF adds no extra empty line.
 */
export function splitLog(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** In-memory Storage. Writes fail for empty names or names ending in `/`. */
export class MemoryStorage implements Storage {
  readonly files = new Map<string, string>();

  constructor(initial: Readonly<Record<string, string>> = {}) {
    for (const [k, v] of Object.entries(initial)) this.files.set(k, v);
  }

  read(name: string): string | undefined {
    return this.files.get(name);
  }

  write(name: string, data: string): boolean {
    if (name === '' || name.endsWith('/')) return false;
    this.files.set(name, data);
    return true;
  }
}

/** Read an upstream file as latin1 so bytes map 1:1 to code units. */
export function readUpstream(fileName: string): string {
  return readFileSync(UPSTREAM_TESTS_DIR + fileName, 'latin1');
}

/** Base names of every `*.log` directly in the upstream tests directory, sorted. */
export function discoverLogs(): string[] {
  return readdirSync(UPSTREAM_TESTS_DIR)
    .filter((f) => f.endsWith('.log'))
    .map((f) => f.slice(0, -'.log'.length))
    .sort();
}

export function hasUpstreamFile(fileName: string): boolean {
  return existsSync(UPSTREAM_TESTS_DIR + fileName);
}

export interface ReplayOptions {
  /** Default seed passed to newGame (logs reseed with the SEED verb). */
  seed?: number;
  /** Storage to share with previously replayed logs. */
  storage?: MemoryStorage;
}

export interface ReplayResult {
  name: string;
  /** Rendered stdout (echo included), as far as the replay got. */
  output: string;
  /** Every event emitted, in order. */
  events: OutputEvent[];
  /** Last good state (undefined if newGame itself failed). */
  finalState: GameState | undefined;
  /** Number of log lines consumed by `step`. */
  linesProcessed: number;
  totalLines: number;
  /** Set when the engine threw; the case is reported as a failure. */
  error: string | undefined;
}

function errorText(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return String(e);
}

function runOne(
  name: string,
  logText: string,
  storage: MemoryStorage,
  seed: number,
): ReplayResult {
  const result: ReplayResult = {
    name,
    output: '',
    events: [],
    finalState: undefined,
    linesProcessed: 0,
    totalLines: 0,
    error: undefined,
  };
  try {
    const opts = parseOptions(logText);
    const lines = splitLog(logText);
    result.totalLines = lines.length;
    const env: Env = { storage };

    const append = (events: OutputEvent[]): void => {
      result.events.push(...events);
      result.output += render(events, { echo: true });
    };

    let state = newGame(seed, { oldstyle: opts.oldstyle });
    result.finalState = state;
    const restoreText =
      opts.restoreFile !== undefined ? storage.read(opts.restoreFile) : undefined;
    const first = start(state, env, restoreText);
    state = first.state;
    result.finalState = state;
    append(first.events);

    for (const line of lines) {
      if (state.session.status === 'over') break;
      const r = step(state, line, env);
      state = r.state;
      result.finalState = state;
      result.linesProcessed++;
      append(r.events);
    }
    if (state.session.status !== 'over') {
      const r = endOfInput(state, env);
      state = r.state;
      result.finalState = state;
      append(r.events);
    }
  } catch (e) {
    result.error = errorText(e);
  }
  return result;
}

/**
 * Replay one upstream log through the engine. Dependency logs (see
 * FIXTURE_DEPENDENCIES) are replayed first into the same storage with their
 * output discarded. A thrown engine error is captured in `result.error`.
 */
export function replayLog(name: string, options: ReplayOptions = {}): ReplayResult {
  const seed = options.seed ?? HARNESS_DEFAULT_SEED;
  const storage = options.storage ?? new MemoryStorage(STATIC_FIXTURES);
  const seen = new Set<string>();
  const runDeps = (n: string): void => {
    for (const dep of FIXTURE_DEPENDENCIES[n] ?? []) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      runDeps(dep);
      runOne(dep, readUpstream(`${dep}.log`), storage, seed);
    }
  };
  runDeps(name);
  return runOne(name, readUpstream(`${name}.log`), storage, seed);
}

/** Result of comparing actual output with a .chk file. */
export interface DiffResult {
  equal: boolean;
  /** 1-based number of the first differing line (when not equal). */
  line?: number;
  expectedLine?: string;
  actualLine?: string;
  message: string;
}

const clip = (s: string): string =>
  s.length > 200 ? `${JSON.stringify(s.slice(0, 200))}...` : JSON.stringify(s);

/** Byte-for-byte comparison; on a mismatch names the log and the first differing line. */
export function diffOutput(name: string, expected: string, actual: string): DiffResult {
  if (expected === actual) return { equal: true, message: `${name}: output matches` };
  const e = expected.split('\n');
  const a = actual.split('\n');
  const n = Math.max(e.length, a.length);
  for (let i = 0; i < n; i++) {
    if (e[i] !== a[i]) {
      const expectedLine = e[i];
      const actualLine = a[i];
      return {
        equal: false,
        line: i + 1,
        ...(expectedLine !== undefined ? { expectedLine } : {}),
        ...(actualLine !== undefined ? { actualLine } : {}),
        message:
          `${name}: first difference at line ${i + 1}\n` +
          `  expected: ${expectedLine === undefined ? '<end of output>' : clip(expectedLine)}\n` +
          `  actual:   ${actualLine === undefined ? '<end of output>' : clip(actualLine)}`,
      };
    }
  }
  return { equal: false, message: `${name}: outputs differ` };
}

/** Replay a log and compare with its .chk. A missing .chk or an engine error is a failure. */
export function checkLog(
  name: string,
  options: ReplayOptions = {},
): { pass: boolean; message: string; replay: ReplayResult | undefined } {
  if (!hasUpstreamFile(`${name}.chk`)) {
    return { pass: false, message: `${name}: missing ${name}.chk`, replay: undefined };
  }
  const expected = readUpstream(`${name}.chk`);
  const replay = replayLog(name, options);
  if (replay.error !== undefined) {
    return { pass: false, message: `${name}: engine error: ${replay.error}`, replay };
  }
  const diff = diffOutput(name, expected, replay.output);
  return { pass: diff.equal, message: diff.message, replay };
}
