import { AlertDialog as AlertDialogPrimitive } from 'radix-ui'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  body: ReactNode
  confirmLabel: string
  onConfirm: () => void
  /** Destructive confirms get the danger treatment. */
  tone?: 'default' | 'danger'
}

/**
 * Confirmation prompt, built straight onto the `radix-ui`
 *
 * The generator rewrites shared files — including the `--ndm-*` token block in
 * `index.css`, which has exactly one theme and no dark variant. Hand-wiring the
 * primitive keeps the focus trap, escape handling and `role="alertdialog"`
 * without risking that.
 *
 * Unlike a plain Dialog, this one does NOT close on an outside click: the whole
 * point is that the answer should be deliberate.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  onConfirm,
  tone = 'default',
}: ConfirmDialogProps) {
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="animate-ndm-fade fixed inset-0 z-[55] bg-[rgba(3,12,16,.7)] backdrop-blur-[3px]" />
        <AlertDialogPrimitive.Content className="bg-card border-b3 rounded-13 animate-ndm-pop fixed top-1/2 left-1/2 z-[56] w-[440px] max-w-[calc(100vw-48px)] -translate-x-1/2 -translate-y-1/2 border p-[18px] shadow-[0_24px_70px_rgba(0,0,0,.6)]">
          <AlertDialogPrimitive.Title className="text-14 mb-[6px] font-semibold">
            {title}
          </AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description className="text-11 text-t2 mb-[16px] leading-[1.5]">
            {body}
          </AlertDialogPrimitive.Description>
          <div className="flex justify-end gap-[8px]">
            <AlertDialogPrimitive.Cancel asChild>
              <Button variant="outline" size="md" className="px-[13px]">
                Cancel
              </Button>
            </AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action asChild>
              <Button
                variant={tone === 'danger' ? 'danger' : 'primary'}
                size="md"
                onClick={onConfirm}
              >
                {confirmLabel}
              </Button>
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  )
}
