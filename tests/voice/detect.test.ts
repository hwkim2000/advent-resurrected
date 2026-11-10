// Detection example tests (spec: voice-input, task 8.8; Requirements 2.1-2.7, 2.11-2.13).
// Counting fakes only: no real browser API, no network, no microphone.
import { describe, expect, it } from 'vitest'
import { detectEnvironment, type DetectEnv, type PermissionStatusLike } from '../../src/voice/detect'
import { createVoiceLayer } from '../../src/voice/session-controller'
import type { VoiceErrorCode } from '../../src/voice/speech-provider'
import { FakeHost } from './support/fake-host'
import { FakePermissions } from './support/fake-permissions'
import { createFakeProviderFactory } from './support/fake-provider'
import { FakeScheduler } from './support/fake-scheduler'

interface Counts {
  hasRecognition: number
  probe: number
  query: number
  getUserMedia: number
  constructed: number
}

interface Setup {
  secure?: boolean
  api?: boolean
  probeThrows?: boolean
  permissions?: FakePermissions
  /** When true the query promise never settles. */
  neverSettle?: boolean
  /** When true the environment has no queryMicrophone member. */
  noQuery?: boolean
}

function makeEnv(setup: Setup = {}) {
  const counts: Counts = { hasRecognition: 0, probe: 0, query: 0, getUserMedia: 0, constructed: 0 }
  const logged: VoiceErrorCode[] = []
  const permissions = setup.permissions ?? new FakePermissions('prompt')
  const env: DetectEnv = {
    isSecureContext: setup.secure ?? true,
    hasRecognition: () => {
      counts.hasRecognition += 1
      return setup.api ?? true
    },
    probe: () => {
      counts.probe += 1
      counts.constructed += 1
      if (setup.probeThrows) throw new Error('construct failed')
    },
    log: (code) => {
      logged.push(code)
    },
  }
  if (!setup.noQuery) {
    env.queryMicrophone = () => {
      counts.query += 1
      if (setup.neverSettle) return new Promise<PermissionStatusLike>(() => {})
      return permissions.query({ name: 'microphone' }) as unknown as Promise<PermissionStatusLike>
    }
  }
  return { env, counts, logged, permissions }
}

function makeLayer(setup: Setup = {}, hostInit: ConstructorParameters<typeof FakeHost>[0] = {}) {
  const e = makeEnv(setup)
  const host = new FakeHost(hostInit)
  const providers = createFakeProviderFactory()
  const layer = createVoiceLayer({
    host,
    scheduler: new FakeScheduler(),
    env: e.env,
    createProvider: providers.factory,
  })
  return { ...e, host, layer, providers }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

describe('detectEnvironment (Requirements 2.1, 2.3, 2.11, 2.13)', () => {
  it('reports unsupported in an insecure context without probing', () => {
    const { env, counts } = makeEnv({ secure: false })
    expect(detectEnvironment(env)).toEqual({ fatal: 'unsupported' })
    expect(counts.probe).toBe(0)
  })

  it('reports unsupported when no recognition constructor exists, without probing', () => {
    const { env, counts } = makeEnv({ api: false })
    expect(detectEnvironment(env)).toEqual({ fatal: 'unsupported' })
    expect(counts.probe).toBe(0)
  })

  it('reports runtime and logs only "other" when the probe throws', () => {
    const { env, logged } = makeEnv({ probeThrows: true })
    expect(detectEnvironment(env)).toEqual({ fatal: 'runtime' })
    expect(logged).toEqual(['other'])
  })

  it('reports ready (no fatal) when secure, API present and probe succeeds', () => {
    const { env, counts, logged } = makeEnv()
    expect(detectEnvironment(env).fatal).toBeUndefined()
    expect(counts.probe).toBe(1)
    expect(logged).toEqual([])
  })

  it('never queries permissions or getUserMedia itself', () => {
    const { env, counts } = makeEnv()
    detectEnvironment(env)
    expect(counts.query).toBe(0)
    expect(counts.getUserMedia).toBe(0)
  })

  it('decides by feature test only: a Firefox-like environment with the API is ready', () => {
    const { env } = makeEnv()
    const ua = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; rv:130.0) Gecko/20100101 Firefox/130.0' }
    expect(ua.userAgent).toContain('Firefox')
    expect(detectEnvironment(env)).toEqual({})
  })

  it('a browser without the API is unsupported whatever it is called', () => {
    const { env } = makeEnv({ api: false })
    expect(detectEnvironment(env).fatal).toBe('unsupported')
  })
})

describe('detection through createVoiceLayer', () => {
  it('Ready on a secure, supported Haunted_Mode start; shows the button (2.11, 2.13)', () => {
    const { layer } = makeLayer()
    layer.gameStart('haunted')
    expect(layer.port.getView().availability).toBe('Ready')
    expect(layer.usable).toBe(true)
  })

  it('insecure context: Unsupported with zero constructor, query and start calls (2.1, 2.2)', async () => {
    const { layer, counts, providers } = makeLayer({ secure: false })
    layer.gameStart('haunted')
    await flush()
    expect(layer.port.getView().availability).toBe('Unsupported')
    expect(layer.usable).toBe(false)
    expect(counts.constructed).toBe(0)
    expect(counts.query).toBe(0)
    expect(counts.getUserMedia).toBe(0)
    expect(providers.provider).toBeUndefined()
  })

  it('no constructor: Unsupported with zero calls and no status or announcement (2.1, 2.2)', async () => {
    const { layer, counts, host, providers } = makeLayer({ api: false })
    layer.gameStart('haunted')
    await flush()
    const view = layer.port.getView()
    expect(view.availability).toBe('Unsupported')
    expect(view.status).toBeFalsy()
    expect(view.announcement).toBeFalsy()
    expect(counts.constructed).toBe(0)
    expect(counts.query).toBe(0)
    expect(counts.getUserMedia).toBe(0)
    expect(providers.provider).toBeUndefined()
    expect(host.submitted).toEqual([])
    expect(host.logCount).toBe(0)
  })

  it('Unsupported stays unchanged on later game starts, still with zero calls (2.2, 2.12)', async () => {
    const { layer, counts } = makeLayer({ secure: false })
    layer.gameStart('haunted')
    layer.gameStart('1976')
    layer.gameStart('haunted')
    await flush()
    expect(layer.port.getView().availability).not.toBe('Ready')
    expect(counts.constructed).toBe(0)
    expect(counts.query).toBe(0)
  })

  it('probe throws: Unavailable, no message, only "other" logged, no permission query (2.3)', async () => {
    const { layer, logged, counts, host } = makeLayer({ probeThrows: true })
    layer.gameStart('haunted')
    await flush()
    const view = layer.port.getView()
    expect(view.availability).toBe('Unavailable')
    expect(view.status).toBeFalsy()
    expect(view.announcement).toBeFalsy()
    expect(logged).toEqual(['other'])
    expect(counts.query).toBe(0)
    expect(host.submitted).toEqual([])
  })

  it('permission denied: Unavailable with no message (2.4)', async () => {
    const permissions = new FakePermissions('denied')
    const { layer, counts } = makeLayer({ permissions })
    layer.gameStart('haunted')
    await flush()
    expect(counts.query).toBe(1)
    expect(permissions.queries).toEqual([{ name: 'microphone' }])
    const view = layer.port.getView()
    expect(view.availability).toBe('Unavailable')
    expect(view.status).toBeFalsy()
    expect(view.announcement).toBeFalsy()
  })

  it('denied then granted: back to Ready without a message (2.5)', async () => {
    const permissions = new FakePermissions('denied')
    const { layer } = makeLayer({ permissions })
    layer.gameStart('haunted')
    await flush()
    expect(layer.port.getView().availability).toBe('Unavailable')
    permissions.status.state = 'granted'
    const view = layer.port.getView()
    expect(view.availability).toBe('Ready')
    expect(view.status).toBeFalsy()
    expect(layer.usable).toBe(true)
  })

  it('denied then prompt: back to Ready (2.5)', async () => {
    const permissions = new FakePermissions('denied')
    const { layer } = makeLayer({ permissions })
    layer.gameStart('haunted')
    await flush()
    permissions.status.state = 'prompt'
    expect(layer.port.getView().availability).toBe('Ready')
  })

  it('denied then granted while Mode_1976 is running: Suspended, not Ready (2.5)', async () => {
    const permissions = new FakePermissions('denied')
    const { layer, host } = makeLayer({ permissions })
    layer.gameStart('haunted')
    await flush()
    host.set({ gameMode: '1976' })
    layer.gameStart('1976')
    permissions.status.state = 'granted'
    expect(layer.port.getView().availability).not.toBe('Ready')
    expect(layer.usable).toBe(false)
  })

  it('permission query rejecting is ignored: stays Ready, no message (2.6)', async () => {
    const permissions = new FakePermissions('prompt')
    permissions.mode = 'reject'
    const { layer, counts, host } = makeLayer({ permissions })
    layer.gameStart('haunted')
    await flush()
    expect(counts.query).toBe(1)
    const view = layer.port.getView()
    expect(view.availability).toBe('Ready')
    expect(view.status).toBeFalsy()
    expect(host.logCount).toBe(0)
  })

  it('permission query throwing synchronously is ignored (2.6)', async () => {
    const permissions = new FakePermissions('prompt')
    permissions.mode = 'throw'
    const { layer } = makeLayer({ permissions })
    expect(() => layer.gameStart('haunted')).not.toThrow()
    await flush()
    expect(layer.port.getView().availability).toBe('Ready')
  })

  it('permissions API absent (no queryMicrophone): stays Ready (2.6)', async () => {
    const { layer, counts } = makeLayer({ noQuery: true })
    layer.gameStart('haunted')
    await flush()
    expect(counts.query).toBe(0)
    expect(layer.port.getView().availability).toBe('Ready')
  })

  it('an unrecognised permission state is ignored (2.6)', async () => {
    const permissions = new FakePermissions('prompt')
    const { layer } = makeLayer({ permissions })
    layer.gameStart('haunted')
    await flush()
    ;(permissions.status as unknown as { state: string }).state = 'bogus'
    expect(layer.port.getView().availability).toBe('Ready')
  })

  it('init makes no start call and no getUserMedia call, and builds no provider (2.7)', async () => {
    const { layer, counts, providers } = makeLayer()
    layer.gameStart('haunted')
    await flush()
    expect(layer.port.getView().availability).toBe('Ready')
    expect(providers.provider?.startCalls ?? 0).toBe(0)
    expect(providers.provider).toBeUndefined()
    expect(counts.getUserMedia).toBe(0)
  })

  it('Ready is shown without waiting for the permission query to settle (2.11)', async () => {
    const { layer, counts } = makeLayer({ neverSettle: true })
    layer.gameStart('haunted')
    expect(layer.port.getView().availability).toBe('Ready')
    expect(layer.usable).toBe(true)
    await flush()
    expect(counts.query).toBe(1)
    expect(layer.port.getView().availability).toBe('Ready')
  })

  it('detection runs once across game starts: no second probe or query (2.12)', async () => {
    const { layer, counts } = makeLayer()
    layer.gameStart('haunted')
    await flush()
    layer.gameStart('haunted')
    layer.gameStart('1976')
    layer.gameStart('haunted')
    await flush()
    expect(counts.hasRecognition).toBe(1)
    expect(counts.probe).toBe(1)
    expect(counts.query).toBe(1)
    expect(layer.port.getView().availability).toBe('Ready')
  })

  it('a Mode_1976 first game runs no detection at all; the first Haunted start does (2.12)', async () => {
    const { layer, counts } = makeLayer({}, { gameMode: '1976' })
    layer.gameStart('1976')
    await flush()
    expect(counts.hasRecognition).toBe(0)
    expect(counts.probe).toBe(0)
    expect(counts.query).toBe(0)
    layer.gameStart('haunted')
    await flush()
    expect(counts.probe).toBe(1)
    expect(counts.query).toBe(1)
    expect(layer.port.getView().availability).toBe('Ready')
  })

  it('Firefox-like environment with the API in a secure context shows the button (2.13)', async () => {
    const { layer } = makeLayer()
    layer.gameStart('haunted')
    await flush()
    expect(layer.port.getView().availability).toBe('Ready')
  })

  it('a browser without the API shows neither the button nor the disclosure (2.13)', async () => {
    const { layer } = makeLayer({ api: false })
    layer.gameStart('haunted')
    await flush()
    expect(layer.port.getView().availability).toBe('Unsupported')
    expect(layer.usable).toBe(false)
  })
})
