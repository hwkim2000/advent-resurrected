// Post-build verification. Run after `npm run build`: `npm run check:dist`.
// Asserts the shape of dist/ (see crt-terminal-ui design, "Build and deploy") and, for the
// ai-parser feature, that no credential pattern ships, that the Pages routing file is right,
// that the credits bundle states the privacy statements, and that no model id leaked in.
// Exits non-zero on any failure.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { VOICE_DISCLOSURE_TEXT } from '../src/shared/voice-disclosure'
import { findCredentials } from './credential-patterns'
import { checkHeadersPolicy } from './headers-policy'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Extensions scanned for credential patterns, plus the extension-less/special names below. */
const SCANNED_EXTENSIONS = new Set(['.js', '.html', '.css', '.map', '.json', '.txt'])
const SCANNED_NAMES = new Set(['_headers', '_routes.json'])

/**
 * Privacy statements (a) to (d) of ai-parser Requirement 11.6. The credits bundle (visible
 * text, lower case, whitespace collapsed) must contain every phrase of every statement.
 */
export const PRIVACY_STATEMENTS: Readonly<Record<string, readonly string[]>> = {
  a: ['cloudflare workers ai', 'third-party', 'short description', 'last two accepted commands'],
  b: ['1976 mode sends no player input'],
  c: ['classic commands', 'never sent'],
  d: ['nothing else about the player or the game is sent'],
  e: ['voice input', 'speech recognition service', 'maker of the browser', 'never records or stores audio'],
  f: ['1976 mode never uses the microphone'],
  g: ['typing always works'],
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile()
}

/** Local references (src/href) in an HTML document, as paths relative to dist. */
function localRefs(html: string): string[] {
  const refs: string[] = []
  const re = /\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    const raw = (m[1] ?? m[2] ?? '').trim()
    if (raw === '' || raw.startsWith('#')) continue
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) continue // external, data:, mailto:
    const path = raw.split(/[?#]/)[0] ?? ''
    if (path === '') continue
    const rel = path.replace(/^\/+/, '')
    if (rel === '') continue // the site root ("/") resolves to index.html
    refs.push(rel)
  }
  return refs
}

/** Every text file (by the scanned extensions/names) under `dir`, recursively. */
function listTextFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listTextFiles(full))
    else if (SCANNED_NAMES.has(entry.name) || SCANNED_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      out.push(full)
    }
  }
  return out
}

/** Visible text of a bundle: tags removed, lower case, whitespace collapsed. */
function visibleText(bundle: string): string {
  return bundle
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

/** Voice-input checks on index.html, _headers and the assets (R14.10, R15, R16.4 to 16.7, R16.10). */
function checkVoice(distDir: string, errors: string[]): void {
  const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim()

  // _headers: must exist and pass the policy (failure messages never echo header values).
  const headersPath = join(distDir, '_headers')
  if (!isFile(headersPath)) {
    errors.push('missing file: dist/_headers')
  } else {
    for (const f of checkHeadersPolicy(readFileSync(headersPath, 'utf8'))) {
      errors.push(`dist/_headers: ${f}`)
    }
  }

  const indexPath = join(distDir, 'index.html')
  if (!isFile(indexPath)) return // already reported as missing
  const html = readFileSync(indexPath, 'utf8')

  const win = new Window()
  try {
    const doc = new win.DOMParser().parseFromString(html, 'text/html')

    const nodes = doc.querySelectorAll('#mic-disclosure')
    if (nodes.length !== 1) {
      errors.push(`dist/index.html: expected exactly one #mic-disclosure element, found ${nodes.length}`)
    } else {
      const el = nodes[0]
      if (el !== undefined) {
        if (!el.hasAttribute('hidden')) {
          errors.push('dist/index.html: #mic-disclosure must have the hidden attribute')
        }
        if (collapse(el.textContent ?? '') !== collapse(VOICE_DISCLOSURE_TEXT)) {
          errors.push('dist/index.html: #mic-disclosure text does not equal VOICE_DISCLOSURE_TEXT')
        }
      }
    }

    // Start-time scripts (script src, modulepreload) must not contain SpeechRecognition.
    const startRefs = new Set<string>()
    for (const s of Array.from(doc.querySelectorAll('script[src]'))) {
      startRefs.add(s.getAttribute('src') ?? '')
    }
    for (const l of Array.from(doc.querySelectorAll('link[rel~="modulepreload"][href]'))) {
      startRefs.add(l.getAttribute('href') ?? '')
    }
    for (const raw of startRefs) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) continue
      const rel = (raw.split(/[?#]/)[0] ?? '').replace(/^\/+/, '')
      if (rel === '') continue
      const target = join(distDir, rel)
      // A missing file is reported by the page check.
      if (isFile(target) && readFileSync(target, 'utf8').includes('SpeechRecognition')) {
        errors.push(`dist/${rel}: loaded at start but contains SpeechRecognition (voice code must load lazily)`)
      }
    }
  } finally {
    void win.happyDOM.close()
  }

  // At least one lazily loaded chunk under dist/assets must contain SpeechRecognition.
  const assets = join(distDir, 'assets')
  let found = false
  if (existsSync(assets)) {
    found = listTextFiles(assets).some(
      (f) => f.endsWith('.js') && readFileSync(f, 'utf8').includes('SpeechRecognition'),
    )
  }
  if (!found) errors.push('no .js file under dist/assets contains SpeechRecognition (voice chunk missing)')
}
/** Runs every check against `distDir`; returns the list of failures (empty when OK). */
export function checkDist(distDir: string): string[] {
  const errors: string[] = []

  const requireFile = (rel: string): boolean => {
    if (isFile(join(distDir, rel))) return true
    errors.push(`missing file: dist/${rel}`)
    return false
  }

  /** Check one page; returns the text of the page plus its local .js files (the "bundle"). */
  const checkPage = (name: string): string => {
    if (!requireFile(name)) return ''
    const html = readFileSync(join(distDir, name), 'utf8')
    let bundle = html
    for (const ref of localRefs(html)) {
      const target = join(distDir, ref)
      if (!isFile(target)) {
        errors.push(`dist/${name}: local reference does not resolve: ${ref}`)
      } else if (ref.endsWith('.js')) {
        bundle += '\n' + readFileSync(target, 'utf8')
      }
    }
    return bundle
  }

  checkPage('index.html')
  const creditsBundle = checkPage('credits.html')

  requireFile('fonts/VT323-Regular.woff2')
  requireFile('fonts/OFL.txt')

  if (creditsBundle !== '') {
    for (const phrase of ['VT323', 'SIL Open Font License']) {
      if (!creditsBundle.includes(phrase)) {
        errors.push(`credits bundle does not mention "${phrase}"`)
      }
    }

    const text = visibleText(creditsBundle)
    for (const [id, phrases] of Object.entries(PRIVACY_STATEMENTS)) {
      const missing = phrases.filter((p) => !text.includes(p))
      if (missing.length > 0) {
        errors.push(`credits bundle lacks privacy statement (${id}); missing: ${missing.map((p) => `"${p}"`).join(', ')}`)
      }
    }

    // A model id in the client would mean server code leaked into the bundle.
    if (creditsBundle.includes('@cf/')) {
      errors.push('credits bundle contains "@cf/" (a model id must never ship to the client)')
    }
  }

  // Pages routing: only /api/* may invoke the Function.
  const routesPath = join(distDir, '_routes.json')
  if (!isFile(routesPath)) {
    errors.push('missing file: dist/_routes.json')
  } else {
    try {
      const routes: unknown = JSON.parse(readFileSync(routesPath, 'utf8'))
      const include = (routes as { include?: unknown } | null)?.include
      if (!Array.isArray(include) || include.length !== 1 || include[0] !== '/api/*') {
        errors.push('dist/_routes.json: "include" must be exactly ["/api/*"]')
      }
    } catch {
      errors.push('dist/_routes.json: not valid JSON')
    }
  }

  checkVoice(distDir, errors)

  // Credential scan over every text file; patterns are reported, never the matched text.
  for (const file of listTextFiles(distDir)) {
    const hits = findCredentials(readFileSync(file, 'utf8'))
    if (hits.length > 0) {
      const rel = relative(distDir, file).split('\\').join('/')
      errors.push(`dist/${rel}: contains credential pattern(s): ${hits.join(' | ')}`)
    }
  }

  return errors
}

function main(): void {
  const dist = join(ROOT, 'dist')
  if (!existsSync(dist)) {
    console.error('check-dist: dist/ does not exist; run `npm run build` first')
    process.exit(1)
  }
  const errors = checkDist(dist)
  if (errors.length > 0) {
    console.error('check-dist: FAILED')
    for (const e of errors) console.error(`  - ${e}`)
    process.exit(1)
  }
  console.log('check-dist: OK')
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
