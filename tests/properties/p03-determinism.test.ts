/*
 * Property 3: Determinism.
 *
 * Ported-game test for Open Adventure (https://gitlab.com/esr/open-adventure).
 * SPDX-FileCopyrightText: Copyright Eric S. Raymond <esr@thyrsus.com>
 * SPDX-License-Identifier: BSD-2-Clause
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';
import { newGame, step } from '../../src/engine';
import {
  assertProperty,
  makeEnv,
  reachableScenario,
  seedArb,
  vocabCommand,
} from '../support/generators';

describe('Property 3: Determinism', () => {
  /**
   * **Validates: Requirements 2.7, 3.1, 16.4**
   */
  it('newGame returns deeply equal states for the same seed and options', () => {
    assertProperty(
      fc.property(seedArb, fc.boolean(), (seed, oldstyle) => {
        const a = newGame(seed, { oldstyle });
        const b = newGame(seed, { oldstyle });
        return isDeepEqual(a, b);
      }),
    );
  });

  /**
   * **Validates: Requirements 2.7, 3.1, 16.4**
   */
  it('step returns deeply equal StepResults for the same state and command', () => {
    assertProperty(
      fc.property(reachableScenario, vocabCommand, (scenario, command) => {
        if (scenario.state.session.status === 'over') return true;
        const a = step(scenario.state, command, makeEnv());
        const b = step(scenario.state, command, makeEnv());
        return isDeepEqual(a, b);
      }),
    );
  });
});

/** Structural deep equality (handles Map/Set/arrays/plain objects). */
function isDeepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) return false;
    for (const [k, v] of a) if (!b.has(k) || !isDeepEqual(v, b.get(k))) return false;
    return true;
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!isDeepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) {
      return false;
    }
  }
  return true;
}
