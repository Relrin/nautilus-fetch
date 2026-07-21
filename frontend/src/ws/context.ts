import { createContext, useContext } from 'react'

import type { WsStatus } from './WsClient'

export interface WsValue {
  status: WsStatus
  /** Epoch ms of the next reconnect attempt, 0 when none is pending. */
  nextAttemptAt: number
  /** Skip the remaining backoff and retry now. */
  reconnectNow: () => void
}

const FALLBACK: WsValue = { status: 'closed', nextAttemptAt: 0, reconnectNow: () => {} }

export const WsContext = createContext<WsValue>(FALLBACK)

/** Live-update transport state. */
export const useWs = (): WsValue => useContext(WsContext)

export const useWsStatus = (): WsStatus => useContext(WsContext).status

/** Whether frames are flowing — consumers use it to decide about polling. */
export const useWsConnected = (): boolean => useWsStatus() === 'open'
