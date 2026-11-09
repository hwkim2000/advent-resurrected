// Credential patterns shared by `scripts/check-dist.ts` and the repository scan test.
//
// Each pattern string is assembled from fragments so that this file does not match
// itself. Only this file and the ai-parser spec documents may spell these names.

/** Patterns for provider keys, tokens and account identifiers. */
export const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  // Authorization header with the bearer scheme.
  new RegExp('Author' + 'ization:\\s*Bea' + 'rer', 'i'),
  new RegExp('CLOUDFLARE' + '_API_' + 'TOKEN'),
  new RegExp('CF_' + 'API_' + 'TOKEN'),
  new RegExp('CLOUDFLARE' + '_ACCOUNT_' + 'ID'),
  new RegExp('acc' + 'ount_' + 'id'),
  // Key-shaped strings: "sk-" followed by 20 or more letters and digits.
  new RegExp('\\bs' + 'k-[A-Za-z0-9]{20,}'),
]

/** Patterns for `VITE_` variables that would carry AI configuration into the client. */
export const VITE_AI_PATTERNS: readonly RegExp[] = [
  new RegExp('\\bVI' + 'TE_[A-Z0-9_]*(?:AI|PARSE|MODEL|KEY|TOKEN|CLOUDFLARE|CF)[A-Z0-9_]*'),
  new RegExp('import\\.meta\\.env\\.VI' + 'TE_'),
]

/**
 * Returns the source of every credential pattern that matches `text` (empty when clean).
 * Pattern sources are returned, not the matched text, so reports never echo a secret.
 */
export function findCredentials(text: string): string[] {
  return CREDENTIAL_PATTERNS.filter((p) => p.test(text)).map((p) => p.source)
}

/** Same as `findCredentials`, for the `VITE_` AI variable patterns. */
export function findViteAiVariables(text: string): string[] {
  return VITE_AI_PATTERNS.filter((p) => p.test(text)).map((p) => p.source)
}
