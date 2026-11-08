/*
 * Renderer: turns Output_Events into the exact bytes the C program writes to stdout.
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

import type { OutputEvent } from './events';

export interface RenderOptions {
  /**
   * Include `echo` events (the `> input` line the C program prints when stdin
   * is not a tty). Default true; an interactive tty front end passes false.
   */
  echo?: boolean;
}

/**
 * Render events to the stdout text of the C program.
 * Non-text events and unknown event types contribute nothing.
 * (Renders the output of C: vspeak, sspeak, echo_input, printf.)
 */
export function render(
  events: readonly OutputEvent[],
  options: RenderOptions = {},
): string {
  const withEcho = options.echo !== false;
  let out = '';
  for (const raw of events) {
    const ev = raw as unknown as Record<string, unknown> | null;
    if (ev === null || typeof ev !== 'object' || ev.type !== 'text') continue;
    const text = typeof ev.text === 'string' ? ev.text : '';
    switch (ev.channel) {
      case 'speak':
      case 'sspeak':
        out += (ev.blank ? '\n' : '') + text + '\n';
        break;
      case 'echo':
        if (withEcho) out += text + '\n';
        break;
      case 'io':
        out += text;
        break;
      default:
        break; // unknown channel: skip
    }
  }
  return out;
}
