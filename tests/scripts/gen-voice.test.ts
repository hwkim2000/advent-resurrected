// ghost-voice task 2.2: pure parts of scripts/gen-voice.ts. No network, no files.
import { describe, expect, it } from 'vitest'
import {
  ENV_ACCOUNT,
  ENV_TOKEN,
  FFMPEG_MISSING_MESSAGE,
  MP3_BITRATE,
  MP3_SAMPLE_RATE,
  TTS_MODEL,
  assertFfmpeg,
  buildRequest,
  decodeTtsResponse,
  dryRunSummary,
  ffmpegArgs,
  isWav,
  planGeneration,
  readCredentials,
  serializeManifest,
  toMp3,
} from '../../scripts/gen-voice'
import type { Manifest, ManifestEntry, SpawnFn } from '../../scripts/gen-voice'
import { voiceKey, voiceLines } from '../../src/haunt/voice-lines'

const MP3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 1, 2, 3])
const MP3_SYNC = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 5, 6])
// "RIFF" <size> "WAVE" + filler: only the header tag matters to the decoder.
const WAV = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 1, 2, 3, 4])
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64')
const json = (v: unknown) => new TextEncoder().encode(JSON.stringify(v))

function manifestFor(lines: string[]): Manifest {
  const entries: Record<string, ManifestEntry> = {}
  for (const l of lines) entries[voiceKey(l)] = { file: `${voiceKey(l)}.mp3`, bytes: 10, text: l }
  return { version: 1, model: TTS_MODEL, entries }
}

describe('planGeneration', () => {
  const lines = ['alpha line', 'beta line']
  const files = lines.map((l) => `${voiceKey(l)}.mp3`)

  it('generates everything when there is no manifest', () => {
    const p = planGeneration(lines, undefined, [], false)
    expect(p.generate).toEqual(lines)
    expect(p.keep).toEqual([])
  })

  it('skips up-to-date lines', () => {
    const p = planGeneration(lines, manifestFor(lines), files, false)
    expect(p.generate).toEqual([])
    expect(p.keep).toEqual(lines)
    expect(p.remove).toEqual([])
  })

  it('regenerates a line whose file is missing', () => {
    const p = planGeneration(lines, manifestFor(lines), files.slice(1), false)
    expect(p.generate).toEqual(['alpha line'])
  })

  it('regenerates everything with force or a different model', () => {
    expect(planGeneration(lines, manifestFor(lines), files, true).generate).toEqual(lines)
    const other = { ...manifestFor(lines), model: 'other' }
    expect(planGeneration(lines, other, files, false).generate).toEqual(lines)
  })

  it('removes orphaned mp3 files only', () => {
    const p = planGeneration(lines, manifestFor(lines), [...files, 'deadbeef.mp3', 'manifest.json'], false)
    expect(p.remove).toEqual(['deadbeef.mp3'])
  })
})

describe('decodeTtsResponse', () => {
  it('decodes JSON with result.audio', () => {
    const out = decodeTtsResponse('application/json', json({ result: { audio: b64(MP3) }, success: true }))
    expect([...out]).toEqual([...MP3])
  })
  it('decodes JSON with top-level audio', () => {
    expect([...decodeTtsResponse('application/json', json({ audio: b64(MP3_SYNC) }))]).toEqual([...MP3_SYNC])
  })
  it('passes raw MP3 through (ID3 and frame sync)', () => {
    expect(decodeTtsResponse('audio/mpeg', MP3)).toBe(MP3)
    expect(decodeTtsResponse('application/octet-stream', MP3_SYNC)).toBe(MP3_SYNC)
  })
  it('decodes JSON with a base64 WAV payload (what MeloTTS returns)', () => {
    const out = decodeTtsResponse('application/json', json({ result: { audio: b64(WAV) } }))
    expect([...out]).toEqual([...WAV])
    expect(isWav(out)).toBe(true)
  })
  it('passes raw WAV through', () => {
    expect(decodeTtsResponse('audio/wav', WAV)).toBe(WAV)
  })
  it('rejects garbage', () => {
    expect(() => decodeTtsResponse('text/plain', new TextEncoder().encode('nope'))).toThrow()
    expect(() => decodeTtsResponse('application/json', new TextEncoder().encode('{bad'))).toThrow()
    expect(() => decodeTtsResponse('application/json', json({ result: {} }))).toThrow()
    expect(() => decodeTtsResponse('application/json', json({ result: { audio: b64(new Uint8Array([1, 2, 3])) } }))).toThrow()
    expect(() => decodeTtsResponse('audio/mpeg', new Uint8Array(0))).toThrow()
  })
})

describe('buildRequest and credentials', () => {
  it('targets the model URL with lang en and a bearer header', () => {
    const r = buildRequest('acct1', 'tok1', 'Hello ghost')
    expect(r.url).toBe('https://api.cloudflare.com/client/v4/accounts/acct1/ai/run/@cf/myshell-ai/melotts')
    expect(r.init.method).toBe('POST')
    expect(JSON.parse(r.init.body)).toEqual({ prompt: 'Hello ghost', lang: 'en' })
    expect(r.init.headers['Author' + 'ization']).toBe('Bearer tok1')
  })
  it('keeps the token out of the URL and body', () => {
    const r = buildRequest('acct1', 'secret-token-value', 'x')
    expect(r.url).not.toContain('secret-token-value')
    expect(r.init.body).not.toContain('secret-token-value')
  })
  it('reports missing variables by name without values', () => {
    expect(() => readCredentials({})).toThrow(new RegExp(`${ENV_ACCOUNT}.*${ENV_TOKEN}`))
    expect(() => readCredentials({ [ENV_ACCOUNT]: 'a' })).toThrow(ENV_TOKEN)
    try {
      readCredentials({ [ENV_ACCOUNT]: 'visible-value' })
    } catch (e) {
      expect((e as Error).message).not.toContain('visible-value')
    }
    expect(readCredentials({ [ENV_ACCOUNT]: 'a', [ENV_TOKEN]: 't' })).toEqual({ accountId: 'a', apiToken: 't' })
  })
})

describe('manifest and dry run', () => {
  it('serializes byte-stably regardless of insertion order', () => {
    const a = { b: { file: 'b.mp3', bytes: 2, text: 'b' }, a: { file: 'a.mp3', bytes: 1, text: 'a' } }
    const b = { a: a.a, b: a.b }
    expect(serializeManifest(a)).toBe(serializeManifest(b))
    const parsed = JSON.parse(serializeManifest(a)) as Manifest
    expect(parsed.version).toBe(1)
    expect(parsed.model).toBe(TTS_MODEL)
    expect(Object.keys(parsed.entries)).toEqual(['a', 'b'])
    expect(serializeManifest(a).endsWith('\n')).toBe(true)
  })
  it('summarizes lines and characters', () => {
    expect(dryRunSummary(['abc', 'de'])).toEqual({ lines: 2, characters: 5 })
    const s = dryRunSummary(voiceLines())
    expect(s.lines).toBe(voiceLines().length)
  })
})

describe('WAV to MP3 transcoding', () => {
  it('recognizes WAV and rejects other bytes', () => {
    expect(isWav(WAV)).toBe(true)
    expect(isWav(MP3)).toBe(false)
    expect(isWav(new Uint8Array(4))).toBe(false)
  })

  it('builds mono 22.05 kHz 48 kbps libmp3lame arguments reading stdin and writing stdout', () => {
    const args = ffmpegArgs()
    const after = (flag: string) => args[args.indexOf(flag) + 1]
    expect(MP3_SAMPLE_RATE).toBe(22050)
    expect(MP3_BITRATE).toBe('48k')
    expect(after('-ac')).toBe('1')
    expect(after('-ar')).toBe('22050')
    expect(after('-b:a')).toBe('48k')
    expect(after('-codec:a')).toBe('libmp3lame')
    expect(after('-i')).toBe('pipe:0')
    expect(args[args.length - 1]).toBe('pipe:1')
    expect(after('-map_metadata')).toBe('-1')
    expect(after('-id3v2_version')).toBe('0')
  })

  it('pipes WAV through ffmpeg and returns the MP3 it prints', () => {
    const calls: { command: string; args: string[]; input?: Uint8Array }[] = []
    const spawn: SpawnFn = (command, args, options) => {
      calls.push({ command, args, input: options.input })
      return { status: 0, stdout: MP3_SYNC }
    }
    const out = toMp3(WAV, spawn)
    expect([...out]).toEqual([...MP3_SYNC])
    expect(calls).toHaveLength(1)
    expect(calls[0]!.command).toBe('ffmpeg')
    expect(calls[0]!.input).toBe(WAV)
  })

  it('does not call ffmpeg for audio that is already MP3', () => {
    const spawn: SpawnFn = () => {
      throw new Error('should not run')
    }
    expect(toMp3(MP3, spawn)).toBe(MP3)
  })

  it('fails clearly when ffmpeg is missing', () => {
    const missing: SpawnFn = () => ({ status: null, error: Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' }) })
    expect(() => assertFfmpeg(missing)).toThrow(FFMPEG_MISSING_MESSAGE)
    expect(() => toMp3(WAV, missing)).toThrow(FFMPEG_MISSING_MESSAGE)
    expect(FFMPEG_MISSING_MESSAGE).toMatch(/ffmpeg/)
    expect(() => assertFfmpeg(() => ({ status: 0 }))).not.toThrow()
  })

  it('reports an ffmpeg failure with its exit code and stderr, and rejects non-MP3 output', () => {
    const failing: SpawnFn = () => ({ status: 1, stdout: new Uint8Array(0), stderr: new TextEncoder().encode('Unknown encoder libmp3lame') })
    expect(() => toMp3(WAV, failing)).toThrow(/exit 1.*libmp3lame/)
    const junk: SpawnFn = () => ({ status: 0, stdout: new Uint8Array([1, 2, 3, 4]) })
    expect(() => toMp3(WAV, junk)).toThrow(/failed to produce MP3/)
  })
})
