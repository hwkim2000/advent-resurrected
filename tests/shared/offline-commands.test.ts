import { describe, expect, it } from 'vitest';
import { offlineCommand } from '../../src/shared/offline-commands';

describe('offlineCommand', () => {
  it.each([
    'switch off the lamp',
    'Switch off the lamp.',
    'turn off the lamp',
    'turn off my lantern',
    'turn the light off',
    'please turn off the light',
    'shut off the lamp now',
    'switch the lamp off',
    'turn out the torch',
  ])('maps %j to EXTIN LAMP', (t) => {
    expect(offlineCommand(t)).toBe('EXTIN LAMP');
  });

  it.each(['turn on the lamp', 'light the lamp', 'take lamp', 'switch off the grate', 'turn off', 'switch off the lamp and run', ''])(
    'leaves %j alone',
    (t) => {
      expect(offlineCommand(t)).toBeUndefined();
    },
  );
});
