/**
 * Latest-wins serial queue.
 *
 * IB paces symbol search at ~1/s, and the backend enforces that with a
 * lock + sleep — so bursting does NOT produce an error, it produces a
 * server-side backlog where every keystroke resolves seconds late and out of
 * order. Two things prevent that: a minimum interval between dispatches, and
 * dropping any request that a newer one has already superseded.
 */
export class SerialQueue {
  private lastDispatch = 0
  private chain: Promise<unknown> = Promise.resolve()
  private generation = 0
  private readonly minIntervalMs: number

  constructor(minIntervalMs: number) {
    this.minIntervalMs = minIntervalMs
  }

  /**
   * Run `task` after the minimum interval has elapsed. If `run` is called
   * again before this one dispatches, the earlier call rejects with
   * `SupersededError` and never reaches the network.
   */
  run<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.generation += 1
    const generation = this.generation
    const controller = new AbortController()

    const result = this.chain.then(async () => {
      if (generation !== this.generation) {
        controller.abort()
        throw new SupersededError()
      }
      const wait = this.lastDispatch + this.minIntervalMs - Date.now()
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
      // Re-check after waiting: a newer query almost certainly arrived during it.
      if (generation !== this.generation) {
        controller.abort()
        throw new SupersededError()
      }
      this.lastDispatch = Date.now()
      return task(controller.signal)
    })

    // Keep the chain alive regardless of outcome, without creating unhandled
    // rejections on the internal handle.
    this.chain = result.catch(() => undefined)
    return result
  }
}

export class SupersededError extends Error {
  constructor() {
    super('Superseded by a newer request')
    this.name = 'SupersededError'
  }
}

export const isSuperseded = (error: unknown): boolean =>
  error instanceof SupersededError || (error instanceof DOMException && error.name === 'AbortError')
