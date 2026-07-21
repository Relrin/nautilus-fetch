import { describe, expect, it, vi } from 'vitest'

import { SerialQueue, isSuperseded } from './rateLimit'

describe('SerialQueue', () => {
  it('drops superseded work before it reaches the network', async () => {
    // The whole point: the backend's limiter is a lock+sleep, so an unthrottled
    // typeahead queues server-side instead of erroring, and every keystroke
    // resolves late and out of order.
    const queue = new SerialQueue(50)
    const dispatched: string[] = []
    const task = (label: string) => () => {
      dispatched.push(label)
      return Promise.resolve(label)
    }

    const first = queue.run(task('AA')).catch((error: unknown) => error)
    const second = queue.run(task('AAP')).catch((error: unknown) => error)
    const third = queue.run(task('AAPL'))

    const results = await Promise.all([first, second, third])

    expect(dispatched).toEqual(['AAPL'])
    expect(isSuperseded(results[0])).toBe(true)
    expect(isSuperseded(results[1])).toBe(true)
    expect(results[2]).toBe('AAPL')
  })

  it('aborts the signal handed to a superseded task', async () => {
    const queue = new SerialQueue(10)
    let captured: AbortSignal | null = null

    const stale = queue
      .run((signal) => {
        captured = signal
        return Promise.resolve('stale')
      })
      .catch(() => 'rejected')
    await queue.run(() => Promise.resolve('fresh'))

    expect(await stale).toBe('rejected')
    // Never dispatched, so the signal is aborted rather than left dangling.
    expect(captured).toBeNull()
  })

  it('spaces consecutive dispatches by the minimum interval', async () => {
    vi.useFakeTimers()
    try {
      const queue = new SerialQueue(1_100)
      const at: number[] = []
      const stamp = () => {
        at.push(Date.now())
        return Promise.resolve(null)
      }

      const first = queue.run(stamp)
      await vi.advanceTimersByTimeAsync(0)
      await first

      const second = queue.run(stamp)
      await vi.advanceTimersByTimeAsync(1_100)
      await second

      expect(at).toHaveLength(2)
      expect(at[1]! - at[0]!).toBeGreaterThanOrEqual(1_100)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps running after a task throws', async () => {
    const queue = new SerialQueue(0)
    await expect(queue.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    await expect(queue.run(() => Promise.resolve('ok'))).resolves.toBe('ok')
  })
})
