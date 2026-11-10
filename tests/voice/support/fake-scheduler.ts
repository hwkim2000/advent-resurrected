// Fake clock and timers for voice tests. No real time is ever used.

interface Timer {
  id: number
  due: number
  seq: number
  fn: () => void
}

export class FakeScheduler {
  private time: number
  private nextId = 1
  private seq = 0
  private timers = new Map<number, Timer>()

  constructor(start = 0) {
    this.time = start
  }

  now(): number {
    return this.time
  }

  setTimer(fn: () => void, ms: number): number {
    const id = this.nextId++
    this.timers.set(id, { id, due: this.time + Math.max(0, ms), seq: this.seq++, fn })
    return id
  }

  clearTimer(id: number | undefined): void {
    if (id !== undefined) this.timers.delete(id)
  }

  /** Number of timers that have not fired and are not cleared. */
  get pending(): number {
    return this.timers.size
  }

  /** Move time forward, firing due timers in due-time order at their due times. */
  advance(ms: number): void {
    const target = this.time + Math.max(0, ms)
    for (;;) {
      let next: Timer | undefined
      for (const t of this.timers.values()) {
        if (t.due > target) continue
        if (next === undefined || t.due < next.due || (t.due === next.due && t.seq < next.seq)) {
          next = t
        }
      }
      if (next === undefined) break
      this.timers.delete(next.id)
      if (next.due > this.time) this.time = next.due
      next.fn()
    }
    this.time = target
  }
}
