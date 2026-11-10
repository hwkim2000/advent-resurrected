// Tests for scripts/headers-policy.ts (voice-input task 12.6, R15.1 to 15.5, 15.8, 15.9).
// Parses the real public/_headers and mutated copies. No browser, no wrangler, no network.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkHeadersPolicy, parseHeadersFile } from '../../scripts/headers-policy'

const REAL = readFileSync(join(__dirname, '..', '..', 'public', '_headers'), 'utf8')

/** Replaces `from` with `to`, failing loudly if the real file no longer contains `from`. */
function mutate(from: string, to: string): string {
  expect(REAL.includes(from)).toBe(true)
  return REAL.replace(from, to)
}

describe('parseHeadersFile', () => {
  it('parses blocks, headers, and ignores comments and blank lines', () => {
    const blocks = parseHeadersFile('# note\n/*\n  A: b: c\n\n  # skip\n  D: e\n/x\n  F: g\n')
    expect(blocks).toEqual([
      {
        pattern: '/*',
        headers: [
          { name: 'A', value: 'b: c' },
          { name: 'D', value: 'e' },
        ],
      },
      { pattern: '/x', headers: [{ name: 'F', value: 'g' }] },
    ])
  })

  it('handles CRLF line endings', () => {
    expect(parseHeadersFile('/*\r\n  A: b\r\n')).toEqual([{ pattern: '/*', headers: [{ name: 'A', value: 'b' }] }])
  })

  it('parses the real file into one /* block with the expected headers', () => {
    const blocks = parseHeadersFile(REAL)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.pattern).toBe('/*')
    const names = blocks[0]?.headers.map((h) => h.name.toLowerCase()) ?? []
    expect(names).toContain('permissions-policy')
    expect(names).toContain('content-security-policy')
  })
})

describe('checkHeadersPolicy', () => {
  it('accepts the real public/_headers', () => {
    expect(checkHeadersPolicy(REAL)).toEqual([])
  })

  const cases: Array<[string, () => string, RegExp]> = [
    ['microphone=()', () => mutate('microphone=(self)', 'microphone=()'), /Permissions-Policy/],
    ['microphone=*', () => mutate('microphone=(self)', 'microphone=*'), /Permissions-Policy/],
    ['microphone=(*)', () => mutate('microphone=(self)', 'microphone=(*)'), /Permissions-Policy/],
    [
      'quoted origin',
      () => mutate('microphone=(self)', 'microphone=("https://example.com")'),
      /Permissions-Policy/,
    ],
    [
      'extra Permissions-Policy directive',
      () => mutate('microphone=(self)', 'microphone=(self), camera=(self)'),
      /Permissions-Policy/,
    ],
    [
      "'unsafe-inline'",
      () => mutate("style-src 'self'", "style-src 'self' 'unsafe-inline'"),
      /'unsafe-inline'/,
    ],
    [
      'http: source',
      () => mutate("connect-src 'self'", "connect-src 'self' http://example.com"),
      /connect-src/,
    ],
    [
      'missing connect-src',
      () => mutate("; connect-src 'self'", ''),
      /missing directive connect-src/,
    ],
    [
      "missing frame-ancestors 'none'",
      () => mutate("; frame-ancestors 'none'", ''),
      /missing directive frame-ancestors/,
    ],
    [
      'second block repeating a header',
      () => `${REAL.trimEnd()}\n/assets/*\n  Permissions-Policy: microphone=(self)\n`,
      /block \/assets\/\* must not repeat Permissions-Policy/,
    ],
    [
      'duplicated Permissions-Policy',
      () => `${REAL.trimEnd()}\n  Permissions-Policy: microphone=(self)\n`,
      /exactly one Permissions-Policy header, found 2/,
    ],
  ]

  for (const [label, make, pattern] of cases) {
    it(`rejects ${label} with a named message`, () => {
      const failures = checkHeadersPolicy(make())
      expect(failures.length).toBeGreaterThan(0)
      expect(failures.some((f) => pattern.test(f))).toBe(true)
    })
  }

  it('rejects a file with no /* block', () => {
    expect(checkHeadersPolicy('/x\n  A: b\n').some((f) => /exactly one \/\* block/.test(f))).toBe(true)
  })
})
