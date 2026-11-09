// Test guard: no test may reach the real network. Registered via `setupFiles`
// in vitest.config.ts. Tests that need fetch must inject a fake explicitly.

export const NO_NETWORK_MESSAGE = "real network request attempted in test";

globalThis.fetch = function guardedFetch(): Promise<Response> {
  throw new Error(NO_NETWORK_MESSAGE);
} as typeof fetch;
