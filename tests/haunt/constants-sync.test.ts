import { expect, it } from 'vitest';
import { DEFLECTION_LIMIT as HAUNT_LIMIT } from '../../src/haunt/spoken-word-rule';
import { DEFLECTION_LIMIT as AUTOSAVE_LIMIT } from '../../src/ui/autosave';

it('DEFLECTION_LIMIT in src/haunt equals the one in src/ui/autosave', () => {
  expect(HAUNT_LIMIT).toBe(AUTOSAVE_LIMIT);
});
