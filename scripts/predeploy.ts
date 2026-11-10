// Pre-deploy checks: typecheck, tests, build, check:dist, then a start-script size report.
// Usage: `npm run predeploy`; `tsx scripts/predeploy.ts --report-only` prints just the report.
// New code; not ported from Open Adventure. Never deploys and makes no network call.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE_PATH = join(ROOT, 'scripts', 'start-script-baseline.json')

export interface Size {
  raw: number
  gzip: number
}

/** The src of the first `<script ... src>` tag (modulepreload links are ignored), or null. */
export function findEntryScript(html: string): string | null {
  const re = /<script\b[^>]*>/gi
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    const attr = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[0])
    const raw = (attr?.[1] ?? attr?.[2] ?? '').trim()
    if (raw === '' || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) continue
    const path = (raw.split(/[?#]/)[0] ?? '').replace(/^\/+/, '')
    if (path !== '') return path
  }
  return null
}

/** Raw and gzip (node:zlib default level) size of a buffer. */
export function measure(data: Uint8Array): Size {
  return { raw: data.byteLength, gzip: gzipSync(data).byteLength }
}

function signed(n: number): string {
  return `${n >= 0 ? '+' : '-'}${Math.abs(n)}`
}

/** Human-readable report; `baseline` null means no baseline is recorded. */
export function formatSizeReport(file: string, size: Size, baseline: Size | null): string {
  const lines = [`Start script: ${file}`, `  raw:  ${size.raw} bytes`, `  gzip: ${size.gzip} bytes`]
  if (baseline === null) {
    lines.push('  baseline: none recorded (scripts/start-script-baseline.json)')
  } else {
    lines.push(
      `  baseline raw:  ${baseline.raw} bytes (delta ${signed(size.raw - baseline.raw)})`,
      `  baseline gzip: ${baseline.gzip} bytes (delta ${signed(size.gzip - baseline.gzip)})`,
    )
  }
  return lines.join('\n')
}

/** Parses the baseline file text; null when absent or malformed. */
export function parseBaseline(text: string | null): Size | null {
  if (text === null) return null
  try {
    const v = JSON.parse(text) as Partial<Size> | null
    if (v !== null && typeof v.raw === 'number' && typeof v.gzip === 'number') {
      return { raw: v.raw, gzip: v.gzip }
    }
  } catch {
    /* fall through */
  }
  return null
}

/** Builds the report from `distDir`; throws when index.html or the entry script is missing. */
export function report(distDir: string = join(ROOT, 'dist'), baselinePath: string = BASELINE_PATH): string {
  const indexPath = join(distDir, 'index.html')
  if (!existsSync(indexPath)) throw new Error('dist/index.html not found; run `npm run build` first')
  const entry = findEntryScript(readFileSync(indexPath, 'utf8'))
  if (entry === null) throw new Error('no entry <script src> found in dist/index.html')
  const file = join(distDir, entry)
  if (!existsSync(file)) throw new Error(`entry script not found: dist/${entry}`)
  const baseline = parseBaseline(existsSync(baselinePath) ? readFileSync(baselinePath, 'utf8') : null)
  return formatSizeReport(entry, measure(readFileSync(file)), baseline)
}

const STEPS: ReadonlyArray<readonly [string, string, readonly string[]]> = [
  ['typecheck', 'npm', ['run', 'typecheck']],
  ['tests', 'npx', ['vitest', '--run']],
  ['build', 'npm', ['run', 'build']],
  ['check:dist', 'npm', ['run', 'check:dist']],
]

function main(): void {
  if (process.argv.includes('--report-only')) {
    try {
      console.log(report())
    } catch (e) {
      console.error(`predeploy: ${(e as Error).message}`)
      process.exit(1)
    }
    return
  }
  const win = process.platform === 'win32'
  for (const [label, cmd, args] of STEPS) {
    console.log(`\npredeploy: ${label} ...`)
    const r = spawnSync(win ? `${cmd}.cmd` : cmd, [...args], { cwd: ROOT, stdio: 'inherit', shell: win })
    if (r.status !== 0) {
      console.error(`\npredeploy: FAILED at "${label}" (exit ${r.status ?? 'signal'}); later steps skipped`)
      process.exit(1)
    }
  }
  console.log('\npredeploy: all checks passed')
  try {
    console.log(report())
  } catch (e) {
    console.error(`predeploy: size report unavailable: ${(e as Error).message}`)
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
