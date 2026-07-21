import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

/** Label above a control. The dialog's only vertical rhythm primitive. */
export function Field({
  label,
  children,
  className,
  hint,
}: {
  label: string
  children: ReactNode
  className?: string
  hint?: string
}) {
  return (
    <div className={className}>
      <div className="text-105 text-t1b mb-[6px] flex items-baseline gap-[6px] font-medium">
        {label}
        {hint ? <span className="text-95 text-t3 font-normal">{hint}</span> : null}
      </div>
      {children}
    </div>
  )
}

/** Shared input chrome: panel surface, b2 border, mono 11px. */
export const inputClass =
  'bg-panel border-b2 rounded-8 text-11 text-t1 w-full border px-[10px] py-[7px] font-mono outline-none focus:border-b3'

export function TextInput({
  className,
  ...props
}: React.ComponentProps<'input'> & { className?: string }) {
  return <input {...props} className={cn(inputClass, className)} />
}
