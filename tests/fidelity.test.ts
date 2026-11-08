/*
 * Fidelity_Suite: replays every upstream Open Adventure `.log` through the
 * TypeScript engine and compares the output byte for byte with the `.chk`.
 * One test per log, named by base filename. The Skip_List entries are reported
 * as named `it.skip` cases carrying their reason.
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

import { describe, expect, it } from 'vitest';
import { SKIP_LIST, SKIP_NAMES } from './fidelity-skip-list';
import { checkLog, discoverLogs, readUpstream } from './replay-harness';

const LOGS = discoverLogs();
const LOG_SET = new Set(LOGS);

/** A skipped log must load a cheat-tool fixture or the C binary save. */
const SKIP_FIXTURE_PATTERN = /cheat_[A-Za-z0-9_]+\.adv|resume_badversion\.adv/;

describe('fidelity: upstream logs', () => {
  it('discovers upstream logs', () => {
    expect(LOGS.length).toBeGreaterThan(0);
  });

  for (const name of LOGS) {
    if (SKIP_NAMES.has(name)) {
      const entry = SKIP_LIST.find((e) => e.name === name);
      it.skip(`${name} (skipped: ${entry?.reason ?? ''})`, () => {});
      continue;
    }
    it(name, () => {
      const result = checkLog(name);
      if (!result.pass) expect.fail(result.message);
    });
  }
});

describe('fidelity: skip list guards', () => {
  it('has exactly 4 entries', () => {
    expect(SKIP_LIST.map((e) => e.name).sort()).toEqual(
      ['cheatresume', 'cheatresume2', 'resumefail2', 'savetamper'],
    );
  });

  for (const entry of SKIP_LIST) {
    it(`skip entry "${entry.name}" matches an existing log`, () => {
      expect(LOG_SET.has(entry.name), `no ${entry.name}.log in upstream tests`).toBe(true);
    });

    it(`skip entry "${entry.name}" uses a cheat/binary-save fixture`, () => {
      if (!LOG_SET.has(entry.name)) expect.fail(`no ${entry.name}.log in upstream tests`);
      const text = readUpstream(`${entry.name}.log`);
      expect(
        SKIP_FIXTURE_PATTERN.test(text),
        `${entry.name}.log uses no cheat/binary-save fixture; it should not be skipped`,
      ).toBe(true);
    });
  }
});
