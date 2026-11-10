// Pure parts of scripts/eval-parser.ts: case list shape, request encoding, scoring.
// The network part never runs here.

import { describe, expect, it } from 'vitest'
import { validateCommand } from '../../src/shared/command-validation'
import { validateContext } from '../../src/shared/context-rules'
import { decodeRequest, encodeRequest } from '../../src/shared/protocol'
import { evalCases } from '../../scripts/eval-parser-cases'
import { classify, formatRow, judge, localOutcome, totals, PACING_MS, EQUIVALENT_COMMANDS, type Row } from '../../scripts/eval-parser'

const cases = evalCases()
const of = (g: string) => cases.filter((c) => c.group === g)

describe('eval cases', () => {
  it('has the planned sizes', () => {
    expect(of('command')).toHaveLength(20)
    expect(of('ask')).toHaveLength(8)
    expect(of('negative')).toHaveLength(6)
  })

  it('has unique texts and ask lines that avoid the ghost prefix', () => {
    expect(new Set(cases.map((c) => c.text)).size).toBe(cases.length)
    for (const c of of('ask')) {
      expect(c.expect).toBe('ghost')
      expect(c.text.toLowerCase().startsWith('ghost')).toBe(false)
    }
  })

  it('every expected command passes validateCommand unchanged', () => {
    for (const c of of('command')) {
      expect(c.expect.startsWith('command:')).toBe(true)
      const cmd = c.expect.slice('command:'.length)
      const r = validateCommand(cmd)
      expect(r.ok && r.command).toBe(cmd)
    }
  })

  it('negatives use no-command or not-ghost', () => {
    for (const c of of('negative')) expect(['no-command', 'not-ghost']).toContain(c.expect)
  })

  it('every request encodes and decodes with a valid context', () => {
    for (const c of cases) {
      expect(validateContext(c.context)).toBe(true)
      const decoded = decodeRequest(JSON.parse(encodeRequest({ text: c.text, context: c.context })))
      expect(decoded).toEqual({ text: c.text, context: c.context })
    }
  })
})

describe('scoring', () => {
  it('classifies outcomes', () => {
    expect(classify({ status: 0 })).toBe('network')
    expect(classify({ status: 200, command: 'GHOST' })).toBe('ghost')
    expect(classify({ status: 200, command: 'TAKE LAMP' })).toBe('command:TAKE LAMP')
    expect(classify({ status: 422, error: 'no_command' })).toBe('no-command')
    expect(classify({ status: 429, error: 'rate_limited' })).toBe('error:rate_limited')
    expect(classify({ status: 500 })).toBe('error:500')
  })

  it('judges expectations', () => {
    expect(judge('ghost', { status: 200, command: 'GHOST' })).toBe(true)
    expect(judge('ghost', { status: 200, command: 'LOOK' })).toBe(false)
    expect(judge('command:LOOK', { status: 200, command: 'LOOK' })).toBe(true)
    expect(judge('command:LOOK', { status: 200, command: 'GHOST' })).toBe(false)
    expect(judge('no-command', { status: 422, error: 'no_command' })).toBe(true)
    expect(judge('no-command', { status: 200, command: 'LOOK' })).toBe(false)
    expect(judge('not-ghost', { status: 200, command: 'GHOST' })).toBe(false)
    expect(judge('not-ghost', { status: 422, error: 'no_command' })).toBe(true)
    expect(judge('not-ghost', { status: 200, command: 'LOOK' })).toBe(true)
  })

  it('transport errors never pass', () => {
    for (const e of ['ghost', 'not-ghost', 'no-command', 'command:LOOK'] as const) {
      expect(judge(e, { status: 0 })).toBe(false)
      expect(judge(e, { status: 429, error: 'rate_limited' })).toBe(false)
      expect(judge(e, { status: 502, error: 'upstream' })).toBe(false)
    }
  })

  it('totals per group and formats rows', () => {
    const [a, b, c] = [cases[0]!, of('ask')[0]!, of('negative')[0]!]
    const rows: Row[] = [
      { c: a, label: 'x', pass: true },
      { c: b, label: 'y', pass: false },
      { c: c, label: 'z', pass: true },
    ]
    const t = totals(rows)
    expect(t).toMatchObject({ total: 3, passed: 2, failed: 1 })
    expect(t.byGroup['ask']).toEqual({ passed: 0, total: 1 })
    expect(formatRow(rows[1]!, 1)).toContain('FAIL')
  })

  it('paces requests under 30 per minute', () => {
    expect(60_000 / PACING_MS).toBeLessThan(30)
  })
})

describe('equivalent originals and the client matcher first', () => {
  it('accepts equivalent originals as passes', () => {
    const ok = (expected: string, got: string) => judge(('command:' + expected) as `command:${string}`, { status: 200, command: got })
    expect(ok('ENTER BUILD', 'ENTER')).toBe(true)
    expect(ok('OUT', 'EXIT')).toBe(true)
    expect(ok('UP', 'CLIMB')).toBe(true)
    expect(ok('OPEN GRATE', 'UNLOC GRATE')).toBe(true)
    expect(ok('ENTER BUILD', 'ENTER BUILD')).toBe(true)
  })

  it('does not accept unrelated or reversed answers', () => {
    expect(judge('command:ENTER BUILD', { status: 200, command: 'LOOK' })).toBe(false)
    expect(judge('command:ENTER', { status: 200, command: 'ENTER BUILD' })).toBe(false)
    expect(judge('command:UP', { status: 200, command: 'DOWN' })).toBe(false)
    expect(judge('command:OUT', { status: 200, command: 'GHOST' })).toBe(false)
    expect(Object.keys(EQUIVALENT_COMMANDS).sort()).toEqual(['ENTER BUILD', 'OPEN GRATE', 'OUT', 'UP'])
  })

  it('every ask sentence is answered by the client matcher (GHOST, no request)', () => {
    for (const c of of('ask')) expect(localOutcome(c.text)).toEqual({ status: 200, command: 'GHOST' })
  })

  it('switch off the lamp is mapped locally and judged against the case', () => {
    const c = cases.find((x) => x.text === 'switch off the lamp')!
    const o = localOutcome(c.text)
    expect(o).toEqual({ status: 200, command: 'EXTIN LAMP' })
    expect(judge(c.expect, o!)).toBe(true)
  })

  it('negatives and ordinary commands still go to the AI', () => {
    for (const c of of('negative')) expect(localOutcome(c.text)).toBeUndefined()
    for (const t of ['pick up the lamp', 'HELP', 'INFO']) expect(localOutcome(t)?.command).not.toBe('EXTIN LAMP')
    expect(localOutcome('HELP')).toBeUndefined()
    expect(localOutcome('INFO')).toBeUndefined()
  })
})