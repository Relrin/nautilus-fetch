import { createContext, useContext } from 'react'

export type ToastTone = 'success' | 'danger' | 'warning' | 'neutral'

export interface Toast {
  id: number
  message: string
  tone: ToastTone
}

export interface ToastValue {
  toasts: Toast[]
  push: (message: string, tone?: ToastTone) => void
  dismiss: (id: number) => void
}

export const ToastContext = createContext<ToastValue | null>(null)

export function useToasts(): ToastValue {
  const value = useContext(ToastContext)
  if (!value) throw new Error('useToasts must be used inside ToastProvider')
  return value
}
