// Temporary dist fixture for the check-dist tests (ai-parser 11.3, voice-input 2.4 and 12.7).
// Builds directories under the OS temp dir only; never touches the real dist/.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PRIVACY_STATEMENTS } from '../../../scripts/check-dist'
import { HAUNT_CHUNK_MARKER } from '../../../src/haunt/haunting'
import { VOICE_DISCLOSURE_TEXT } from '../../../src/shared/voice-disclosure'

export const PRIVACY_TEXT = Object.values(PRIVACY_STATEMENTS)
  .map((phrases) => `<p>${phrases.join(' ')}</p>`)
  .join('\n')

// Voice-input credits phrases (voice-input task 2.4); the same phrases the new check-dist expects.
export const VOICE_CREDITS_PHRASES = [
  'voice input',
  'speech recognition service',
  'maker of the browser',
  'never records or stores audio',
  '1976 mode never uses the microphone',
  'typing always works',
]

export const COMPLIANT_HEADERS = `/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; media-src 'self'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: microphone=(self)
`

export function creditsHtml(phrases: readonly string[]): string {
  return `<!doctype html><html><body>
<p>VT323 under the SIL Open Font License</p>
${PRIVACY_TEXT}
${phrases.map((p) => `<p>${p}</p>`).join('\n')}
</body></html>`
}

export const CREDITS_HTML = creditsHtml(VOICE_CREDITS_PHRASES)

export function indexHtml(disclosure: string | null): string {
  const block = disclosure === null ? '' : `<p id="mic-disclosure" hidden>${disclosure}</p>`
  return `<!doctype html><html><body>hello${block}<script type="module" src="/assets/index.js"></script></body></html>`
}

const tmpDirs: string[] = []

export interface Overrides {
  files?: Record<string, string | null> // null deletes a default file
  // Fixture pieces for the voice-input checks; each replaces one default piece.
  disclosureText?: string | null // text of #mic-disclosure; null omits the element
  headers?: string | null // _headers content; null deletes the file
  startScript?: string // the script index.html loads at start
  voiceChunk?: string | null // lazily loaded assets chunk; null deletes it
  creditsPhrases?: readonly string[] // voice phrases in credits.html
}

export function makeDist(over: Overrides = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'check-dist-'))
  tmpDirs.push(dir)
  const files: Record<string, string | null> = {
    'index.html': indexHtml(over.disclosureText === undefined ? VOICE_DISCLOSURE_TEXT : over.disclosureText),
    'credits.html': over.creditsPhrases ? creditsHtml(over.creditsPhrases) : CREDITS_HTML,
    '_headers': over.headers === undefined ? COMPLIANT_HEADERS : over.headers,
    'assets/index.js': over.startScript ?? 'export const start = () => import("./voice.js")',
    'assets/voice.js':
      over.voiceChunk === undefined ? 'export const API = "webkitSpeechRecognition" in window' : over.voiceChunk,
    'assets/haunt.js': `export const M = "${HAUNT_CHUNK_MARKER}"`,
    'fonts/VT323-Regular.woff2': 'font',
    'fonts/OFL.txt': 'license',
    '_routes.json': JSON.stringify({ version: 1, include: ['/api/*'], exclude: [] }),
    ...over.files,
  }
  for (const [rel, content] of Object.entries(files)) {
    if (content === null) continue
    const full = join(dir, rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  return dir
}

/** Removes every directory made by makeDist; call from afterEach. */
export function cleanupDists(): void {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true })
}
