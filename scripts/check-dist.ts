// Post-build verification. Run after `npm run build`: `npm run check:dist`.
// Asserts the shape of dist/ (see crt-terminal-ui design, "Build and deploy").
// Exits non-zero on any failure.

import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')

const errors: string[] = []

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile()
}

function requireFile(rel: string): boolean {
  if (isFile(join(DIST, rel))) return true
  errors.push(`missing file: dist/${rel}`)
  return false
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

/** Check one page; returns the text of the page plus its local .js files (the "bundle"). */
function checkPage(name: string): string {
  if (!requireFile(name)) return ''
  const html = readFileSync(join(DIST, name), 'utf8')
  let bundle = html
  for (const ref of localRefs(html)) {
    const target = join(DIST, ref)
    if (!isFile(target)) {
      errors.push(`dist/${name}: local reference does not resolve: ${ref}`)
    } else if (ref.endsWith('.js')) {
      bundle += '\n' + readFileSync(target, 'utf8')
    }
  }
  return bundle
}

if (!existsSync(DIST)) {
  console.error('check-dist: dist/ does not exist; run `npm run build` first')
  process.exit(1)
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
}

if (errors.length > 0) {
  console.error('check-dist: FAILED')
  for (const e of errors) console.error(`  - ${e}`)
  process.exit(1)
}
console.log('check-dist: OK')
