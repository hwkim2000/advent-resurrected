// Voice-input checks of scripts/check-dist.ts (voice-input task 12.7; R16.4 to 16.7, 16.10, 18.17).
// Each failing condition has its own test on a temporary dist. No wrangler, no network, no browser.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkDist, PRIVACY_STATEMENTS } from '../../scripts/check-dist'
import { VOICE_DISCLOSURE_TEXT } from '../../src/shared/voice-disclosure'
import { COMPLIANT_HEADERS, CREDITS_HTML, cleanupDists, indexHtml, makeDist } from './support/make-dist'

afterEach(cleanupDists)

/** Replaces `from` with `to` in the compliant headers, failing loudly if `from` is absent. */
function headers(from: string, to: string): string {
  expect(COMPLIANT_HEADERS.includes(from), `fixture lacks ${from}`).toBe(true)
  return COMPLIANT_HEADERS.replace(from, to)
}

/** Snapshot of every file (relative path -> content) under `dir`. */
function snapshot(dir: string, base = dir, out: Record<string, string> = {}): Record<string, string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) snapshot(full, base, out)
    else out[full.slice(base.length)] = readFileSync(full, 'utf8')
  }
  return out
}

describe('check-dist voice checks: clean build', () => {
  it('passes the unmodified fixture', () => {
    expect(checkDist(makeDist())).toEqual([])
  })
})

describe('check-dist voice checks: credits phrases (entries e, f, g)', () => {
  const cases = (['e', 'f', 'g'] as const).flatMap((id) =>
    (PRIVACY_STATEMENTS[id] ?? []).map((phrase) => [id, phrase] as const),
  )

  it.each(cases)('fails when statement (%s) lacks the phrase "%s"', (id, phrase) => {
    const html = CREDITS_HTML.split(phrase).join('')
    const errors = checkDist(makeDist({ files: { 'credits.html': html } }))
    expect(errors.some((e) => e.includes(`privacy statement (${id})`) && e.includes(`"${phrase}"`))).toBe(true)
  })

  it('does not accept "maker of your browser" for "maker of the browser"', () => {
    const html = CREDITS_HTML.split('maker of the browser').join('maker of your browser')
    const errors = checkDist(makeDist({ files: { 'credits.html': html } }))
    expect(errors.some((e) => e.includes('privacy statement (e)') && e.includes('"maker of the browser"'))).toBe(true)
  })
})

describe('check-dist voice checks: index.html disclosure', () => {
  it('fails when the disclosure element is absent', () => {
    const errors = checkDist(makeDist({ disclosureText: null }))
    expect(errors.some((e) => e.includes('exactly one #mic-disclosure') && e.includes('found 0'))).toBe(true)
  })

  it('fails when the disclosure text differs', () => {
    const errors = checkDist(makeDist({ disclosureText: 'Something else entirely.' }))
    expect(errors.some((e) => e.includes('#mic-disclosure text does not equal'))).toBe(true)
  })

  it('fails when the hidden attribute is missing', () => {
    const html = indexHtml(VOICE_DISCLOSURE_TEXT).replace(' hidden', '')
    expect(html).not.toContain('hidden')
    const errors = checkDist(makeDist({ files: { 'index.html': html } }))
    expect(errors.some((e) => e.includes('#mic-disclosure must have the hidden attribute'))).toBe(true)
  })

  it('fails when there are two #mic-disclosure elements', () => {
    const one = `<p id="mic-disclosure" hidden>${VOICE_DISCLOSURE_TEXT}</p>`
    const html = indexHtml(VOICE_DISCLOSURE_TEXT).replace(one, one + one)
    const errors = checkDist(makeDist({ files: { 'index.html': html } }))
    expect(errors.some((e) => e.includes('exactly one #mic-disclosure') && e.includes('found 2'))).toBe(true)
  })

  it('fails when the apostrophe differs', () => {
    expect(VOICE_DISCLOSURE_TEXT).toContain("'")
    const errors = checkDist(makeDist({ disclosureText: VOICE_DISCLOSURE_TEXT.replace("'", '\u2019') }))
    expect(errors.some((e) => e.includes('#mic-disclosure text does not equal'))).toBe(true)
  })
})

describe('check-dist voice checks: _headers', () => {
  it('fails when dist/_headers is missing', () => {
    const errors = checkDist(makeDist({ headers: null }))
    expect(errors).toContain('missing file: dist/_headers')
  })

  const cases: Array<[string, string, RegExp]> = [
    ['no Permissions-Policy line', headers('  Permissions-Policy: microphone=(self)\n', ''), /Permissions-Policy/],
    ['microphone=()', headers('microphone=(self)', 'microphone=()'), /Permissions-Policy/],
    ['microphone=*', headers('microphone=(self)', 'microphone=*'), /Permissions-Policy/],
    ["'unsafe-inline'", headers("style-src 'self'", "style-src 'self' 'unsafe-inline'"), /unsafe-inline/],
    ["'unsafe-eval'", headers("script-src 'self'", "script-src 'self' 'unsafe-eval'"), /unsafe-eval/],
    ['an http: origin', headers("connect-src 'self'", "connect-src 'self' http://example.com"), /connect-src/],
    ['an https: origin', headers("connect-src 'self'", "connect-src 'self' https://example.com"), /connect-src/],
    ["no default-src 'self'", headers("default-src 'self'; ", ''), /missing directive default-src/],
    ["no connect-src 'self'", headers("; connect-src 'self'", ''), /missing directive connect-src/],
    ["no frame-ancestors 'none'", headers("; frame-ancestors 'none'", ''), /missing directive frame-ancestors/],
    ['no X-Content-Type-Options: nosniff', headers('  X-Content-Type-Options: nosniff\n', ''), /X-Content-Type-Options/],
  ]

  it.each(cases)('fails with %s', (_label, content, pattern) => {
    const errors = checkDist(makeDist({ headers: content }))
    expect(errors.some((e) => e.startsWith('dist/_headers:') && pattern.test(e))).toBe(true)
  })
})

describe('check-dist voice checks: lazy SpeechRecognition', () => {
  it('fails when a script referenced by index.html contains SpeechRecognition', () => {
    const errors = checkDist(makeDist({ startScript: 'export const r = new webkitSpeechRecognition()' }))
    expect(errors.some((e) => e.includes('dist/assets/index.js') && e.includes('loaded at start'))).toBe(true)
  })

  it('fails when no file under dist/assets contains SpeechRecognition (chunk missing)', () => {
    const errors = checkDist(makeDist({ voiceChunk: null }))
    expect(errors.some((e) => e.includes('voice chunk missing'))).toBe(true)
  })

  it('fails when the chunk exists but lacks SpeechRecognition', () => {
    const errors = checkDist(makeDist({ voiceChunk: 'export const API = 1' }))
    expect(errors.some((e) => e.includes('voice chunk missing'))).toBe(true)
  })
})

describe('check-dist voice checks: reporting', () => {
  it('reports every failure of one run together', () => {
    const errors = checkDist(
      makeDist({
        headers: headers('microphone=(self)', 'microphone=()'),
        disclosureText: null,
        voiceChunk: null,
      }),
    )
    expect(errors.some((e) => e.startsWith('dist/_headers:'))).toBe(true)
    expect(errors.some((e) => e.includes('#mic-disclosure'))).toBe(true)
    expect(errors.some((e) => e.includes('voice chunk missing'))).toBe(true)
  })

  it('prints no header or disclosure values', () => {
    const errors = checkDist(
      makeDist({
        headers: headers("connect-src 'self'", "connect-src 'self' https://leak.example.com"),
        disclosureText: 'Secret replacement disclosure text.',
      }),
    ).join('\n')
    expect(errors.length).toBeGreaterThan(0)
    expect(errors).not.toContain('leak.example.com')
    expect(errors).not.toContain('Secret replacement disclosure text.')
    expect(errors).not.toContain(VOICE_DISCLOSURE_TEXT)
  })

  it('does not modify the dist directory', () => {
    const dir = makeDist({ headers: null, disclosureText: null, voiceChunk: null })
    const before = snapshot(dir)
    checkDist(dir)
    expect(snapshot(dir)).toEqual(before)
  })
})
