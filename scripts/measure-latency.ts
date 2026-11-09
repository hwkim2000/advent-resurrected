// Owner tool: measures the round-trip time of POST /api/parse on a DEPLOYED site.
//   npm run measure:latency -- https://<project>.pages.dev
// Sends 20 requests spaced at least 2,100 ms apart (about 28 per minute, under the limit of
// 30), then prints p50, p95, the count per status code, and the command returned for each
// sentence so the owner can judge translation quality. Costs about 40 Neurons.
// The agent and CI never run this against a real URL. summarize() and runMeasurement() are
// pure (fetch, clock and sleep are injected) and are unit-tested offline.

import { pathToFileURL } from 'node:url'
import { roomText, validateContext, type GameContext } from '../src/shared/context-rules'
import { encodeRequest } from '../src/shared/protocol'

/** Minimum gap between two request starts, in milliseconds. */
export const MIN_GAP_MS = 2100
/** Number of requests sent by one run. */
export const REQUEST_COUNT = 20

export interface Sample {
  status: number
  ms: number
}

export interface Summary {
  count: number
  p50: number
  p95: number
  statusCounts: Record<string, number>
}

/** Nearest-rank percentile: sorted[ceil(q * n) - 1]. */
function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))
  return sorted[idx] ?? 0
}

/** p50 and p95 of the round-trip times, and a count per status code (0 = network failure). */
export function summarize(samples: readonly Sample[]): Summary {
  const sorted = samples.map((s) => s.ms).sort((a, b) => a - b)
  const statusCounts: Record<string, number> = {}
  for (const s of samples) {
    const key = String(s.status)
    statusCounts[key] = (statusCounts[key] ?? 0) + 1
  }
  return {
    count: samples.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    statusCounts,
  }
}

export interface SentenceCase {
  text: string
  context: GameContext
}

export interface MeasurementDeps {
  fetch: typeof fetch
  now: () => number
  sleep: (ms: number) => Promise<void>
  baseUrl: string
  sentences: readonly SentenceCase[]
  log?: (line: string) => void
}

export interface MeasurementResult {
  samples: Sample[]
  commands: { text: string; status: number; command: string }[]
  summary: Summary
}

/** Sends REQUEST_COUNT requests (cycling through the sentences), at least MIN_GAP_MS apart. */
export async function runMeasurement(deps: MeasurementDeps): Promise<MeasurementResult> {
  const { fetch: doFetch, now, sleep, baseUrl, sentences } = deps
  const log = deps.log ?? (() => undefined)
  if (sentences.length === 0) throw new Error('no sentences to send')
  const url = new URL('/api/parse', baseUrl).toString()
  const samples: Sample[] = []
  const commands: MeasurementResult['commands'] = []
  let lastStart: number | undefined

  for (let i = 0; i < REQUEST_COUNT; i++) {
    const item = sentences[i % sentences.length] as SentenceCase
    if (lastStart !== undefined) {
      const wait = lastStart + MIN_GAP_MS - now()
      if (wait > 0) await sleep(wait)
    }
    const start = now()
    lastStart = start
    let status = 0
    let command = ''
    try {
      const res = await doFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: encodeRequest({ text: item.text, context: item.context }),
      })
      status = res.status
      try {
        const body: unknown = await res.json()
        if (typeof body === 'object' && body !== null) {
          const rec = body as Record<string, unknown>
          if (typeof rec['command'] === 'string') command = rec['command']
          else if (typeof rec['error'] === 'string') command = `(error: ${rec['error']})`
        }
      } catch {
        // Body is not JSON; only the status matters.
      }
    } catch {
      status = 0
      command = '(network failure)'
    }
    const ms = Math.max(0, now() - start)
    samples.push({ status, ms })
    commands.push({ text: item.text, status, command })
    log(`${String(i + 1).padStart(2)}. ${status} ${ms} ms  "${item.text}" -> ${command}`)
  }

  const summary = summarize(samples)
  return { samples, commands, summary }
}

function ctx(loc: number, objects: string[], last: string[]): GameContext {
  return { room: roomText(loc), objects, last }
}

/** Default sentences with valid contexts (validated at start-up by the CLI). */
export function defaultSentences(): SentenceCase[] {
  return [
    { text: "I'll go inside", context: ctx(1, ['KEYS', 'LAMP'], []) },
    { text: 'please pick up the lamp', context: ctx(3, ['LAMP', 'KEYS'], ['ENTER BUILD']) },
    { text: 'let me look around', context: ctx(3, [], ['TAKE LAMP']) },
    { text: 'walk toward the west', context: ctx(1, [], []) },
    { text: 'unlock the grate with the keys', context: ctx(1, ['GRATE', 'KEYS'], ['TAKE KEYS']) },
    { text: 'what am I carrying?', context: ctx(3, [], ['TAKE LAMP', 'TAKE KEYS']) },
    { text: 'turn on the light', context: ctx(3, ['LAMP'], ['TAKE LAMP']) },
    { text: 'get out of here', context: ctx(3, [], []) },
  ]
}

async function main(argv: readonly string[]): Promise<number> {
  const baseUrl = argv[0]
  if (baseUrl === undefined || !/^https?:\/\//i.test(baseUrl)) {
    console.error('usage: npm run measure:latency -- https://<project>.pages.dev')
    return 2
  }
  const sentences = defaultSentences()
  for (const s of sentences) {
    if (!validateContext(s.context)) {
      console.error(`internal error: invalid context for "${s.text}"`)
      return 2
    }
  }
  console.log(`Measuring ${REQUEST_COUNT} requests against ${baseUrl} (about 42 s)...`)
  const { summary } = await runMeasurement({
    fetch,
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    baseUrl,
    sentences,
    log: (line) => console.log(line),
  })
  console.log('')
  console.log(`requests: ${summary.count}`)
  console.log(`p50: ${summary.p50} ms`)
  console.log(`p95: ${summary.p95} ms`)
  for (const [code, n] of Object.entries(summary.statusCounts).sort()) {
    console.log(`status ${code}: ${n}`)
  }
  return 0
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
