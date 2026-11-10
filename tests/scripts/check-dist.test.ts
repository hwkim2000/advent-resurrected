// Tests for scripts/check-dist.ts (ai-parser task 11.3). Uses temporary dist directories only.
// Credential samples are assembled at run time so this file never matches the repository scan.

import { afterEach, describe, expect, it } from 'vitest'
import { checkDist, PRIVACY_STATEMENTS } from '../../scripts/check-dist'
import { HAUNT_CHUNK_MARKER } from '../../src/haunt/haunting'
import { HINT_TABLE_MARKER } from '../../src/haunt/hints'
import { GHOST_VOICE_CHUNK_MARKER } from '../../src/ui/dom/ghost-voice'
import { CREDITS_HTML, cleanupDists, makeDist } from './support/make-dist'

const CRED_TOKEN = 'CLOUDFLARE' + '_API_' + 'TOKEN=abc'
const CRED_ACCOUNT = 'acc' + 'ount_' + 'id: "0000"'
const CRED_KEY = 's' + 'k-' + 'A1b2C3d4E5f6G7h8I9j0K1'
const MODEL_ID = '@' + 'cf/meta/some-model'

afterEach(cleanupDists)

describe('check-dist', () => {
  it('passes a clean dist', () => {
    expect(checkDist(makeDist())).toEqual([])
  })

  it('names each file with a planted credential (.js, .map, .json)', () => {
    const dir = makeDist({
      files: {
        'assets/app.js': `var a = "${CRED_TOKEN}"`,
        'assets/app.js.map': `{"sourcesContent":["${CRED_KEY}"]}`,
        'assets/data.json': `{"x":"${CRED_ACCOUNT.replace(/"/g, '')}"}`,
      },
    })
    const errors = checkDist(dir).join('\n')
    expect(errors).toContain('dist/assets/app.js:')
    expect(errors).toContain('dist/assets/app.js.map:')
    expect(errors).toContain('dist/assets/data.json:')
    expect(errors).not.toContain(CRED_KEY) // patterns are reported, never the matched text
  })

  it('fails when _routes.json is missing', () => {
    const errors = checkDist(makeDist({ files: { '_routes.json': null } }))
    expect(errors.some((e) => e.includes('_routes.json'))).toBe(true)
  })

  it('fails when _routes.json has the wrong include', () => {
    for (const body of [
      JSON.stringify({ version: 1, include: ['/*'], exclude: [] }),
      JSON.stringify({ version: 1, include: ['/api/*', '/x'], exclude: [] }),
      JSON.stringify({ version: 1, exclude: [] }),
      'not json',
    ]) {
      const errors = checkDist(makeDist({ files: { '_routes.json': body } }))
      expect(errors.some((e) => e.includes('_routes.json')), body).toBe(true)
    }
  })

  it('fails when the credits bundle contains a model id', () => {
    const dir = makeDist({
      files: {
        'credits.html': CREDITS_HTML.replace('</body>', '<script src="/assets/c.js"></script></body>'),
        'assets/c.js': `const m = "${MODEL_ID}"`,
      },
    })
    expect(checkDist(dir).some((e) => e.includes('@cf/'))).toBe(true)
  })

  it('fails when the start script contains the haunt chunk marker', () => {
    const dir = makeDist({ startScript: `const m = "${HAUNT_CHUNK_MARKER}"; import("./voice.js")` })
    expect(checkDist(dir).some((e) => e.includes('dist/assets/index.js') && e.includes('haunt chunk marker'))).toBe(true)
  })

  it('fails when no lazy chunk contains the haunt chunk marker', () => {
    const dir = makeDist({ files: { 'assets/haunt.js': null } })
    expect(checkDist(dir).some((e) => e.includes('haunt chunk missing'))).toBe(true)
  })

  it('does not count the start script as the lazy haunt chunk', () => {
    const dir = makeDist({
      startScript: `const m = "${HAUNT_CHUNK_MARKER}"`,
      files: { 'assets/haunt.js': null },
    })
    const errors = checkDist(dir).join('\n')
    expect(errors).toContain('loaded at start')
    expect(errors).toContain('haunt chunk missing')
  })

  it('fails when the start script contains the Ghost_Voice marker', () => {
    const dir = makeDist({ startScript: `const m = "${GHOST_VOICE_CHUNK_MARKER}"; import("./voice.js")` })
    expect(checkDist(dir).some((e) => e.includes('dist/assets/index.js') && e.includes('Ghost_Voice chunk marker'))).toBe(true)
  })

  it('fails when no lazy chunk contains the Ghost_Voice marker', () => {
    const dir = makeDist({ files: { 'assets/ghost.js': null } })
    expect(checkDist(dir).some((e) => e.includes('Ghost_Voice chunk missing'))).toBe(true)
  })

  it('fails when the start script contains the hint table marker', () => {
    const dir = makeDist({ startScript: `const m = "${HINT_TABLE_MARKER}"; import("./voice.js")` })
    expect(checkDist(dir).some((e) => e.includes('dist/assets/index.js') && e.includes('hint table chunk marker'))).toBe(true)
  })

  it('fails when no lazy chunk contains the hint table marker', () => {
    const dir = makeDist({ files: { 'assets/hints.js': null } })
    expect(checkDist(dir).some((e) => e.includes('hint table chunk missing'))).toBe(true)
  })

  it('does not scan dist/voice/*.mp3 as text for credentials', () => {
    const dir = makeDist({ files: { 'voice/aaaa0001.mp3': `ID3 ${CRED_TOKEN}`, 'voice/manifest.json': '{"version":1,"entries":{}}' } })
    expect(checkDist(dir)).toEqual([])
  })

  it('fails when a dist/voice/manifest.json contains a credential', () => {
    const dir = makeDist({ files: { 'voice/manifest.json': `{"x":"${CRED_TOKEN}"}` } })
    expect(checkDist(dir).join('\n')).toContain('dist/voice/manifest.json:')
  })

  it('fails when a privacy statement is missing', () => {
    for (const [id, phrases] of Object.entries(PRIVACY_STATEMENTS)) {
      let html = CREDITS_HTML
      for (const p of phrases) html = html.split(p).join('')
      const errors = checkDist(makeDist({ files: { 'credits.html': html } }))
      expect(errors.some((e) => e.includes(`privacy statement (${id})`)), id).toBe(true)
    }
  })
})
