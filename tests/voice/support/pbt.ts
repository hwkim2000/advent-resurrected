// Shared property-test runner for the voice-input spec.
import fc from 'fast-check'

export const VOICE_SEED = 20261031

/** Run a fast-check property with the fixed voice seed and at least 100 runs. */
export function voiceAssert<T extends unknown[]>(
  property: fc.IPropertyWithHooks<T> | fc.IAsyncPropertyWithHooks<T>,
  runs = 100,
): void | Promise<void> {
  return fc.assert(property as fc.IPropertyWithHooks<T>, {
    numRuns: Math.max(100, runs),
    seed: VOICE_SEED,
    verbose: 1,
  })
}
