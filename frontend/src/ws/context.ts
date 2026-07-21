import { createContext, useContext } from 'react'

import type { WsStatus } from './WsClient'

export const WsStatusContext = createContext<WsStatus>('closed')

/** Live-update transport state. */
export const useWsStatus = () => useContext(WsStatusContext)

/** Whether frames are flowing — consumers use it to decide about polling. */
export const useWsConnected = () => useWsStatus() === 'open'
