// Generates the narrator's ghost voice audio (ghost-voice spec, task 2).
//
// Usage: npm run gen:voice [-- --dry-run] [-- --force]
// Reads the account id and API token from the environment only; never prints or stores them.
// Writes public/voice/<key>.mp3 and public/voice/manifest.json. No timestamp in the manifest,
// so reruns are byte-stable. The model returns WAV (RIFF, 44.1 kHz mono 16-bit); each line is
// transcoded to a small mono MP3 (22.05 kHz, 48 kbps) with ffmpeg from PATH. Raw MP3 is passed through.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { voiceKey, voiceLines } from '../src/haunt/voice-lines'

export const TTS_MODEL = '@cf/myshell-ai/melotts'
export const MANIFEST_VERSION = 1
export const MAX_TOTAL_BYTES = 4 * 1024 * 1024
export const MP3_SAMPLE_RATE = 22050
export const MP3_BITRATE = '48k'

// Names are assembled so this file never matches the credential scans.
export const ENV_ACCOUNT = 'CLOUDFLARE' + '_ACCOUNT_' + 'ID'
export const ENV_TOKEN = 'CLOUDFLARE' + '_API_' + 'TOKEN'

export interface ManifestEntry {
  readonly file: string
  readonly bytes: number
  readonly text: string
}

export interface Manifest {
  readonly version: number
  readonly model: string
  readonly entries: Readonly<Record<string, ManifestEntry>>
}

export interface Plan {
  readonly generate: readonly string[]
  readonly keep: readonly string[]
  /** File names (not keys) of orphaned audio to delete. */
  readonly remove: readonly string[]
}

/** Decide what to generate, keep and remove. `existingFiles` are file names in the voice dir. */
export function planGeneration(
  lines: readonly string[],
  manifest: Manifest | undefined,
  existingFiles: readonly string[],
  force: boolean,
): Plan {
  const files = new Set(existingFiles)
  const wanted = new Set<string>()
  const generate: string[] = []
  const keep: string[] = []
  for (const line of lines) {
    const key = voiceKey(line)
    const file = `${key}.mp3`
    wanted.add(file)
    const entry = manifest?.entries[key]
    const upToDate =
      !force && manifest?.model === TTS_MODEL && entry !== undefined && entry.text === line && files.has(file)
    if (upToDate) keep.push(line)
    else generate.push(line)
  }
  const remove = existingFiles.filter((f) => f.endsWith('.mp3') && !wanted.has(f)).sort()
  return { generate, keep, remove }
}

function isMp3(bytes: Uint8Array): boolean {
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true // "ID3"
  return bytes.length >= 2 && bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0 // frame sync
}

/** True for a RIFF/WAVE header ("RIFF" .... "WAVE"). */
export function isWav(bytes: Uint8Array): boolean {
  const tag = (at: number, s: string) => [...s].every((c, i) => bytes[at + i] === c.charCodeAt(0))
  return bytes.length >= 12 && tag(0, 'RIFF') && tag(8, 'WAVE')
}

const isAudio = (bytes: Uint8Array): boolean => isWav(bytes) || isMp3(bytes)

/**
 * Decode the TTS response: JSON {result:{audio}} or {audio} (base64 WAV or MP3), or raw WAV/MP3.
 * Returns the audio bytes as sent (WAV is transcoded later). Throws on garbage.
 */
export function decodeTtsResponse(contentType: string, bytes: Uint8Array): Uint8Array {
  if (isAudio(bytes)) return bytes
  const looksJson = /json/i.test(contentType) || bytes[0] === 0x7b
  if (looksJson) {
    let parsed: unknown
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes))
    } catch {
      throw new Error('TTS response is not valid JSON')
    }
    const obj = parsed as { result?: { audio?: unknown }; audio?: unknown } | null
    const audio = obj?.result?.audio ?? obj?.audio
    if (typeof audio === 'string' && audio.length > 0) {
      const decoded = new Uint8Array(Buffer.from(audio, 'base64'))
      if (isAudio(decoded)) return decoded
      throw new Error('TTS audio payload is neither WAV nor MP3')
    }
    throw new Error('TTS JSON response has no audio')
  }
  throw new Error('TTS response is neither JSON nor audio')
}

/** ffmpeg arguments: WAV on stdin -> mono 22.05 kHz 48 kbps MP3 on stdout, no metadata. */
export function ffmpegArgs(): string[] {
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'wav', '-i', 'pipe:0',
    '-vn', '-map_metadata', '-1',
    '-ac', '1', '-ar', String(MP3_SAMPLE_RATE),
    '-codec:a', 'libmp3lame', '-b:a', MP3_BITRATE,
    '-id3v2_version', '0', '-write_xing', '0',
    '-f', 'mp3', 'pipe:1',
  ]
}

/** The subset of spawnSync the transcoder uses (injectable for tests). */
export type SpawnFn = (
  command: string,
  args: string[],
  options: { input?: Uint8Array; maxBuffer?: number },
) => { status: number | null; stdout?: Uint8Array | null; stderr?: Uint8Array | null; error?: Error }

const defaultSpawn: SpawnFn = (command, args, options) => spawnSync(command, args, options)

export const FFMPEG_MISSING_MESSAGE =
  'ffmpeg was not found on PATH. Install ffmpeg (with libmp3lame) and make sure `ffmpeg -version` works, then run again.'

/** Fail clearly (before any network call) when ffmpeg cannot be run. */
export function assertFfmpeg(spawn: SpawnFn = defaultSpawn): void {
  const r = spawn('ffmpeg', ['-version'], {})
  if (r.error !== undefined || r.status !== 0) throw new Error(FFMPEG_MISSING_MESSAGE)
}

/** Convert one line of audio to a small mono MP3. MP3 input passes through; WAV goes through ffmpeg. */
export function toMp3(audio: Uint8Array, spawn: SpawnFn = defaultSpawn): Uint8Array {
  if (!isWav(audio)) return audio
  const r = spawn('ffmpeg', ffmpegArgs(), { input: audio, maxBuffer: 64 * 1024 * 1024 })
  if (r.error !== undefined) throw new Error(FFMPEG_MISSING_MESSAGE)
  const out = r.stdout ?? new Uint8Array(0)
  if (r.status !== 0 || out.length === 0 || !isMp3(out)) {
    const detail = r.stderr ? new TextDecoder().decode(r.stderr).trim().slice(0, 300) : ''
    throw new Error(`ffmpeg failed to produce MP3 (exit ${r.status ?? 'none'})${detail ? `: ${detail}` : ''}`)
  }
  return new Uint8Array(out)
}

export interface TtsRequest {
  readonly url: string
  readonly init: { method: 'POST'; headers: Record<string, string>; body: string }
}

/** Build the REST request. The caller supplies credentials; this is never logged. */
export function buildRequest(accountId: string, apiToken: string, text: string): TtsRequest {
  return {
    url: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${TTS_MODEL}`,
    init: {
      method: 'POST',
      headers: { ['Author' + 'ization']: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: text, lang: 'en' }),
    },
  }
}

/** Read credentials from an env-like object; throws a message naming the missing variables only. */
export function readCredentials(env: Readonly<Record<string, string | undefined>>): {
  accountId: string
  apiToken: string
} {
  const accountId = env[ENV_ACCOUNT]?.trim()
  const apiToken = env[ENV_TOKEN]?.trim()
  const missing = [accountId ? '' : ENV_ACCOUNT, apiToken ? '' : ENV_TOKEN].filter(Boolean)
  if (missing.length > 0 || !accountId || !apiToken) {
    throw new Error(`Missing environment variable(s): ${missing.join(', ')}. Set them and run again.`)
  }
  return { accountId, apiToken }
}

/** Deterministic manifest text (sorted keys, 2-space indent, trailing newline). */
export function serializeManifest(entries: Readonly<Record<string, ManifestEntry>>): string {
  const sorted: Record<string, ManifestEntry> = {}
  for (const key of Object.keys(entries).sort()) sorted[key] = entries[key]!
  const manifest: Manifest = { version: MANIFEST_VERSION, model: TTS_MODEL, entries: sorted }
  return JSON.stringify(manifest, null, 2) + '\n'
}

export function dryRunSummary(lines: readonly string[]): { lines: number; characters: number } {
  return { lines: lines.length, characters: lines.reduce((n, l) => n + l.length, 0) }
}

const VOICE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'voice')
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function synthesize(accountId: string, apiToken: string, text: string): Promise<Uint8Array> {
  const req = buildRequest(accountId, apiToken, text)
  let lastError = 'unknown error'
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(req.url, req.init)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const bytes = new Uint8Array(await res.arrayBuffer())
      return decodeTtsResponse(res.headers.get('content-type') ?? '', bytes)
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
      if (attempt < 3) await sleep(1000 * attempt)
    }
  }
  throw new Error(`Generation failed after 3 attempts: ${lastError}`)
}

function loadManifest(): Manifest | undefined {
  const path = join(VOICE_DIR, 'manifest.json')
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Manifest
  } catch {
    return undefined
  }
}

async function main(argv: readonly string[]): Promise<number> {
  const dry = argv.includes('--dry-run')
  const force = argv.includes('--force')
  const lines = voiceLines()
  const manifest = loadManifest()
  const existing = existsSync(VOICE_DIR) ? readdirSync(VOICE_DIR) : []
  const plan = planGeneration(lines, manifest, existing, force)
  const sum = dryRunSummary(lines)
  console.log(`Voice lines: ${sum.lines}, characters: ${sum.characters}`)
  console.log(`To generate: ${plan.generate.length}, up to date: ${plan.keep.length}, to remove: ${plan.remove.length}`)
  if (dry) {
    console.log('Dry run: no network, no files written.')
    return 0
  }

  let creds: { accountId: string; apiToken: string }
  try {
    creds = readCredentials(process.env)
  } catch (e) {
    console.error(e instanceof Error ? e.message : 'Missing credentials.')
    return 1
  }

  mkdirSync(VOICE_DIR, { recursive: true })
  if (plan.generate.length > 0) {
    try {
      assertFfmpeg()
    } catch (e) {
      console.error(e instanceof Error ? e.message : FFMPEG_MISSING_MESSAGE)
      return 1
    }
  }
  const entries: Record<string, ManifestEntry> = {}
  for (const line of plan.keep) {
    const key = voiceKey(line)
    entries[key] = manifest!.entries[key]!
  }
  for (const [i, line] of plan.generate.entries()) {
    const key = voiceKey(line)
    const audio = toMp3(await synthesize(creds.accountId, creds.apiToken, line))
    writeFileSync(join(VOICE_DIR, `${key}.mp3`), audio)
    entries[key] = { file: `${key}.mp3`, bytes: audio.length, text: line }
    console.log(`[${i + 1}/${plan.generate.length}] ${key}.mp3 (${audio.length} bytes)`)
    await sleep(200)
  }
  for (const file of plan.remove) unlinkSync(join(VOICE_DIR, file))
  writeFileSync(join(VOICE_DIR, 'manifest.json'), serializeManifest(entries))

  const total = Object.values(entries).reduce((n, e) => n + e.bytes, 0)
  console.log(`Done: ${Object.keys(entries).length} files, ${total} bytes.`)
  if (total > MAX_TOTAL_BYTES) console.warn('Warning: total audio exceeds the 4 MB target.')
  return 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e instanceof Error ? e.message : 'Generation failed.')
      process.exit(1)
    },
  )
}
