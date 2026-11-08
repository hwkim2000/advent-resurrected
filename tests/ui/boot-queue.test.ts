// Feature: crt-terminal-ui, bugfix: lines submitted during the boot are delivered in order.

import { describe, expect, it } from 'vitest';
import { ExtensionHooks } from '../../src/ui/extension-hooks';
import { GameController } from '../../src/ui/game-controller';
import { MemoryKeyValueStore } from '../../src/ui/kv-store';
import { SETTINGS_KEY } from '../../src/ui/save-store';
import { printSettings } from '../../src/ui/settings';
import { FakeClock, FakeMotion, FakeTerminal, RecordingLogger } from './support/fakes';

function make() {
  const kv = new MemoryKeyValueStore();
  kv.set(SETTINGS_KEY, printSettings({ mode: '1976', speed: 'instant', crt: true }));
  const view = new FakeTerminal();
  const log = new RecordingLogger();
  const controller = new GameController({
    kv,
    clock: new FakeClock(1),
    motion: new FakeMotion(false),
    view,
    hooks: new ExtensionHooks(log),
    log,
  });
  return { controller, view, log };
}

describe('lines submitted around the boot', () => {
  it('delivers lines submitted during booting and right after skip() in order', () => {
    const { controller, view, log } = make();
    controller.startBoot();
    controller.tick(0);
    controller.submit('n'); // during the boot
    controller.skip();
    controller.submit('in'); // immediately after skip
    controller.tick(0);

    const echoed = view.instantLines.filter((l) => l.kind === 'input').map((l) => l.text);
    expect(echoed.map((t) => t.trim())).toEqual(['n', 'in']);
    const original = view.textOfKind('original');
    expect(original).not.toContain('Please answer the question');
    expect(original).toContain('inside a building');
    expect(log.entries).toEqual([]);
  });

  it('keeps the input enabled during the boot', () => {
    const { controller, view } = make();
    controller.startBoot();
    expect(controller.phase).toBe('booting');
    expect(view.inputEnabled).toBe(true);
  });
});
