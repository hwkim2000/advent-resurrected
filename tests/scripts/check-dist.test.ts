// Tests for scripts/check-dist.ts (ai-parser task 11.3). Uses temporary dist directories only.
// Credential samples are assembled at run time so this file never matches the repository scan.

import { afterEach, describe, expect, it } from 'vitest'
import { checkDist, PRIVACY_STATEMENTS } from '../../scripts/check-dist'
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

  it('fails when a privacy statement is missing', () => {
    for (const [id, phrases] of Object.entries(PRIVACY_STATEMENTS)) {
      let html = CREDITS_HTML
      for (const p of phrases) html = html.split(p).join('')
      const errors = checkDist(makeDist({ files: { 'credits.html': html } }))
      expect(errors.some((e) => e.includes(`privacy statement (${id})`)), id).toBe(true)
    }
  })
})
