import { parseFrame, type WsFrame } from './protocol'

export type WsStatus = 'connecting' | 'open' | 'closed'

const BACKOFF_MIN_MS = 1_000
const BACKOFF_MAX_MS = 30_000
/** A socket that survived this long is considered healthy; reset its backoff. */
const STABLE_AFTER_MS = 10_000
/** The hub ignores our messages but needs `receive_text()` pumping. Also stops
 *  an Unraid reverse proxy idling the connection out. */
const KEEPALIVE_MS = 25_000

/**
 * The app's single WebSocket. Framework-free so it can be tested and reasoned
 * about without React in the picture.
 */
export class WsClient {
  private socket: WebSocket | null = null
  private status: WsStatus = 'closed'
  private attempt = 0
  private openedAt = 0
  /** Epoch ms of the next scheduled attempt, 0 when none is pending. */
  private nextAttemptAt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null
  private stopped = true
  private readonly listeners = new Set<() => void>()
  private readonly onFrame: (frame: WsFrame) => void
  private readonly onOpen: () => void

  constructor(onFrame: (frame: WsFrame) => void, onOpen: () => void) {
    this.onFrame = onFrame
    this.onOpen = onOpen
  }

  /** Same-origin, so it works through the Vite proxy in dev and directly in
   *  production off the `static/` mount. No environment variable needed. */
  private url(): string {
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
    return `${scheme}://${window.location.host}/ws`
  }

  start(): void {
    if (!this.stopped && this.socket) return
    this.stopped = false
    this.connect()
  }

  stop(): void {
    this.stopped = true
    this.clearTimers()
    if (this.socket) {
      this.socket.onclose = null
      this.socket.close()
      this.socket = null
    }
    this.setStatus('closed')
  }

  getStatus = (): WsStatus => this.status

  /** Epoch ms of the next retry, or 0 when nothing is scheduled. */
  getNextAttemptAt = (): number => this.nextAttemptAt

  /**
   * Retry immediately instead of waiting out the backoff.
   *
   * Backoff protects the server from a stampede, not the user from their own
   * deliberate click — someone who has just restarted the backend should not
   * have to wait up to 30 seconds to see it come back.
   */
  reconnectNow = (): void => {
    if (this.status === 'open') return
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.attempt = 0
    this.nextAttemptAt = 0
    this.stopped = false
    this.connect()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  private setStatus(next: WsStatus): void {
    if (this.status === next) return
    this.status = next
    this.notify()
  }

  private clearTimers(): void {
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer)
    if (this.keepaliveTimer !== null) clearInterval(this.keepaliveTimer)
    this.reconnectTimer = null
    this.keepaliveTimer = null
  }

  private connect(): void {
    if (this.stopped) return
    this.setStatus('connecting')

    let socket: WebSocket
    try {
      socket = new WebSocket(this.url())
    } catch {
      this.scheduleReconnect()
      return
    }
    this.socket = socket

    socket.onopen = () => {
      this.openedAt = Date.now()
      this.nextAttemptAt = 0
      this.setStatus('open')
      this.keepaliveTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send('ping')
      }, KEEPALIVE_MS)
      // Frames are advisory: whatever happened while we were disconnected was
      // missed entirely, so the caller must re-sync from REST.
      this.onOpen()
    }

    socket.onmessage = (event: MessageEvent<unknown>) => {
      const frame = parseFrame(event.data)
      if (frame) this.onFrame(frame)
    }

    socket.onerror = () => {
      // `onclose` always follows; reconnect is handled there.
    }

    socket.onclose = () => {
      this.socket = null
      this.clearTimers()
      this.setStatus('closed')
      if (this.stopped) return
      if (Date.now() - this.openedAt > STABLE_AFTER_MS) this.attempt = 0
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return
    // Full jitter: without it, every browser tab reconnects in lockstep and
    // stampedes the backend after a restart.
    const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** this.attempt)
    const delay = BACKOFF_MIN_MS + Math.random() * (ceiling - BACKOFF_MIN_MS)
    this.attempt += 1
    this.nextAttemptAt = Date.now() + delay
    this.reconnectTimer = setTimeout(() => this.connect(), delay)
    // Status is already `closed`, so setStatus would not fire — but the pill
    // counts down to this timestamp and needs to hear about it.
    this.notify()
  }
}
