import { CheckCircle2, TriangleAlert, XCircle } from 'lucide-react'

import { useToasts, type ToastTone } from '@/state/toastsContext'

const ICON: Record<ToastTone, typeof CheckCircle2> = {
  success: CheckCircle2,
  danger: XCircle,
  warning: TriangleAlert,
  neutral: CheckCircle2,
}

const COLOR: Record<ToastTone, string> = {
  success: 'var(--ndm-success)',
  danger: 'var(--ndm-danger)',
  warning: 'var(--ndm-warning)',
  neutral: 'var(--ndm-t1b)',
}

export function ToastHost() {
  const { toasts, dismiss } = useToasts()
  if (toasts.length === 0) return null

  return (
    <div className="fixed right-[16px] bottom-[16px] z-60 flex flex-col gap-[8px]">
      {toasts.map((toast) => {
        const Icon = ICON[toast.tone]
        return (
          <button
            key={toast.id}
            type="button"
            onClick={() => dismiss(toast.id)}
            className="bg-track border-b3 rounded-10 animate-ndm-toast flex cursor-pointer items-center gap-[9px] border px-[14px] py-[10px] text-left shadow-[0_12px_32px_rgba(0,0,0,0.5)]"
          >
            <Icon size={14} strokeWidth={2.4} color={COLOR[toast.tone]} />
            <span className="text-115 text-t1">{toast.message}</span>
          </button>
        )
      })}
    </div>
  )
}
