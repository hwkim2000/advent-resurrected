// Owner tool: evaluates POST /api/parse against fixed sentences.
//   npm run eval:parser -- http://127.0.0.1:8788        (npm run dev:pages)
//   npm run eval:parser -- https://<project>.pages.dev
// Sends one request per case, 2.5 s apart (under the 30 per minute per address limit), prints
// a table and totals, and exits non-zero if any case fails. It consumes Workers AI quota
// (one request per case). Needs no credentials. The agent, tests and CI never run it against
// a server; classify() and judge() are pure and unit-tested offline.

import { pathToFileURL } from 'node:url'
import { encodeRequest } from '../src/shared/protocol'
import { evalCases, type EvalCase, type Expectation } from './eval-parser-cases'

/** Gap between two request starts, in milliseconds. */
export const PACING_MS = 2500

export interface Outcome {
  /** HTTP status; 0 for a network failure. */
  status: number
  /** Body `command` on 200, else undefined. */
  command?: string
  /** Body `error` code on a non-200, else undefined. */
  error?: string
}

/** Short label for an outcome: command:<X>, ghost, no-command, error:<code|status>, network. */
export function classify(o: Outcome): string {
  if (o.status === 0) return 'network'
  if (o.status === 200 && typeof o.command === 'string') {
    return o.command === 'GHOST' ? 'ghost' : `command:${o.command}`
  }
  if (o.status === 422 && o.error === 'no_command') return 'no-command'
  return `error:${o.error ?? String(o.status)}`
}

/** True when the outcome satisfies the expectation. Errors and network failures never pass. */
export function judge(expect: Expectation, o: Outcome): boolean {
  const label = classify(o)
  if (label === 'network' || label.startsWith('error:')) return false
  if (expect === 'not-ghost') return label !== 'ghost'
  return label === expect
}

export interface Row {
  c: EvalCase
  label: string
  pass: boolean
}

export interface Totals {
  total: number
  passed: number
  failed: number
  byGroup: Record<string, { passed: number; total: number }>
}

export function totals(rows: readonly Row[]): Totals {
  const byGroup: Totals['byGroup'] = {}
  let passed = 0
  for (const r of rows) {
    const g = (byGroup[r.c.group] ??= { passed: 0, total: 0 })
    g.total++
    if (r.pass) {
      g.passed++
      passed++
    }
  }
  return { total: rows.length, passed, failed: rows.length - passed, byGroup }
}

export function formatRow(r: Row, index: number): string {
  return `${String(index + 1).padStart(2)}. ${r.pass ? 'PASS' : 'FAIL'} [${r.c.group}] "${r.c.text}" expect ${r.c.expect} got ${r.label}`
}

async function send(doFetch: typeof fetch, url: string, c: EvalCase): Promise<Outcome> {
  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: encodeRequest({ text: c.text, context: c.context }),
    })
    const o: Outcome = { status: res.status }
    try {
      const body: unknown = await res.json()
      if (typeof body === 'object' && body !== null) {
        const rec = body as Record<string, unknown>
        if (typeof rec['command'] === 'string') o.command = rec['command']
        if (typeof rec['error'] === 'string') o.error = rec['error']
      }
    } catch {
      // Body is not JSON; the status alone decides.
    }
    return o
  } catch {
    return { status: 0 }
  }
}

async function main(argv: readonly string[]): Promise<number> {
  const baseUrl = argv[0]
  if (baseUrl === undefined || !/^https?:\/\//i.test(baseUrl)) {
    console.error('usage: npm run eval:parser -- <base-url>   e.g. http://127.0.0.1:8788')
    return 2
  }
  const url = new URL('/api/parse', baseUrl).toString()
  const cases = evalCases()
  console.log(`Evaluating ${cases.length} cases against ${url} (about ${Math.round((cases.length * PACING_MS) / 1000)} s)...`)
  const rows: Row[] = []
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i] as EvalCase
    if (i > 0) await new Promise((r) => setTimeout(r, PACING_MS))
    const o = await send(fetch, url, c)
    const row: Row = { c, label: classify(o), pass: judge(c.expect, o) }
    rows.push(row)
    console.log(formatRow(row, i))
  }
  const t = totals(rows)
  console.log('')
  for (const [g, v] of Object.entries(t.byGroup)) console.log(`${g}: ${v.passed}/${v.total}`)
  console.log(`total: ${t.passed}/${t.total} passed, ${t.failed} failed`)
  return t.failed === 0 ? 0 : 1
}

const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code
    },
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err))
      process.exitCode = 1
    },
  )
}
