// voice-input Requirement 13.8: one game-start notification fans out to independent handlers;
// a throwing handler never prevents the others from running.

import { describe, expect, it } from 'vitest';
import { createGameStartFanOut } from '../../src/game-start-fanout';
import type { Mode } from '../../src/ui/types';
import { RecordingLogger } from './support/fakes';

describe('createGameStartFanOut', () => {
  it('calls every handler in order with the mode', () => {
    const calls: string[] = [];
    const fan = createGameStartFanOut(
      [(m) => calls.push(`a:${m}`), (m) => calls.push(`b:${m}`)],
      new RecordingLogger(),
    );
    fan('haunted');
    fan('1976');
    expect(calls).toEqual(['a:haunted', 'b:haunted', 'a:1976', 'b:1976']);
  });

  it('a throwing first handler does not stop the second, and is logged once', () => {
    const log = new RecordingLogger();
    const seen: Mode[] = [];
    const boom = new Error('boom');
    const fan = createGameStartFanOut(
      [
        () => {
          throw boom;
        },
        (m) => seen.push(m),
      ],
      log,
    );
    expect(() => fan('haunted')).not.toThrow();
    expect(seen).toEqual(['haunted']);
    expect(log.entries).toEqual([{ message: 'game start handler failed', cause: boom }]);
  });

  it('a throwing last handler does not undo the earlier one', () => {
    const log = new RecordingLogger();
    const seen: Mode[] = [];
    const fan = createGameStartFanOut(
      [
        (m) => seen.push(m),
        () => {
          throw new Error('late');
        },
      ],
      log,
    );
    expect(() => fan('1976')).not.toThrow();
    expect(seen).toEqual(['1976']);
    expect(log.entries.length).toBe(1);
  });
});
