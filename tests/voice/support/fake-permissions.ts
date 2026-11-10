// Fake navigator.permissions for voice tests.

export type FakePermissionState = 'granted' | 'denied' | 'prompt'

export class FakePermissionStatus {
  onchange: (() => void) | null = null
  private current: FakePermissionState
  private listeners: Array<() => void> = []

  constructor(state: FakePermissionState) {
    this.current = state
  }

  get state(): FakePermissionState {
    return this.current
  }

  /** Set the state and notify `onchange` and `change` listeners. */
  set state(next: FakePermissionState) {
    this.current = next
    this.onchange?.()
    for (const l of [...this.listeners]) l()
  }

  addEventListener(type: string, listener: () => void): void {
    if (type === 'change') this.listeners.push(listener)
  }

  removeEventListener(type: string, listener: () => void): void {
    if (type === 'change') this.listeners = this.listeners.filter((l) => l !== listener)
  }
}

export type FakePermissionsMode = 'ok' | 'reject' | 'throw'

export class FakePermissions {
  mode: FakePermissionsMode = 'ok'
  readonly status: FakePermissionStatus
  readonly queries: unknown[] = []

  constructor(state: FakePermissionState = 'prompt') {
    this.status = new FakePermissionStatus(state)
  }

  query = (descriptor: unknown): Promise<FakePermissionStatus> => {
    this.queries.push(descriptor)
    if (this.mode === 'throw') throw new TypeError('query threw')
    if (this.mode === 'reject') return Promise.reject(new TypeError('query rejected'))
    return Promise.resolve(this.status)
  }
}
