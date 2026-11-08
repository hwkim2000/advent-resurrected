// Feature: crt-terminal-ui, win430 UI test (Requirements 1.4, 15.4).
// Plays the upstream win430.log through GameController with a fake view, clock and store.
// The final score is read from the last `game-over` event (430). The last `score`
// event reads 426 because the end-of-game bonuses are only added into game-over.

import { describe, expect, it } from 'vitest';
import { render } from '../../src/engine/index';
import type { OutputEvent } from '../../src/engine/index';
import { ExtensionHooks } from '../../src/ui/extension-hooks';
import { GameController } from '../../src/ui/game-controller';
import { MemoryKeyValueStore } from '../../src/ui/kv-store';
import { SETTINGS_KEY } from '../../src/ui/save-store';
import { printSettings } from '../../src/ui/settings';
import {
  HARNESS_DEFAULT_SEED,
  parseOptions,
  readUpstream,
  replayLog,
  splitLog,
} from '../replay-harness';
import { FakeClock, FakeMotion, FakeTerminal, RecordingLogger } from './support/fakes';

describe('win430 through the GameController', () => {
  it('reaches 430 points in the final game-over event and shows the engine text unchanged', () => {
    const logText = readUpstream('win430.log');
    const options = parseOptions(logText);
    const lines = splitLog(logText);

    // Seed = clock.now() | 0 must equal the harness default seed.
    const clock = new FakeClock(HARNESS_DEFAULT_SEED);
    const kv = new MemoryKeyValueStore();
    // Same options as the upstream harness: oldstyle follows the selected Mode.
    kv.set(
      SETTINGS_KEY,
      printSettings({ mode: options.oldstyle ? '1976' : 'haunted', speed: 'instant', crt: true }),
    );
    const view = new FakeTerminal();
    const log = new RecordingLogger();
    const hooks = new ExtensionHooks(log);
    const gameOvers: Extract<OutputEvent, { type: 'game-over' }>[] = [];
    hooks.addEventObserver((events) => {
      for (const e of events) if (e.type === 'game-over') gameOvers.push(e);
    });

    const controller = new GameController({
      kv,
      clock,
      motion: new FakeMotion(false),
      view,
      hooks,
      log,
    });

    controller.startBoot();
    controller.tick(0);
    controller.skip(); // boot is revealed at once; the game starts
    expect(controller.phase).toBe('ready');
    expect(controller.gameMode).toBe(options.oldstyle ? '1976' : 'haunted');

    for (const line of lines) {
      if (controller.phase !== 'ready') break;
      controller.submit(line);
    }
    controller.tick(0);

    expect(log.entries).toEqual([]);
    expect(controller.engineState?.session.status).toBe('over');
    expect(gameOvers.length).toBeGreaterThan(0);
    const last = gameOvers[gameOvers.length - 1];
    expect(last?.score).toBe(430);

    const expected = render(replayLog('win430').events, { echo: false });
    expect(view.textOfKind('original')).toBe(expected);
  });
});
