import { cn } from '@/lib/cn'
import { PAGES, useSelection, type Page } from '@/state/selectionContext'

const LABEL: Record<Page, string> = {
  queue: 'Queue',
  schedules: 'Schedules',
  catalog: 'Catalog',
}

export function TabStrip() {
  const { page, setPage } = useSelection()

  return (
    <nav className="ml-[4px] flex items-stretch gap-[2px]" aria-label="Pages">
      {PAGES.map((id) => {
        const active = page === id
        return (
          <button
            key={id}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={() => setPage(id)}
            // Full 50px height so the 2px underline sits flush on the header's
            // own bottom border rather than floating above it.
            className={cn(
              'text-125 hover:text-t1 flex h-[50px] cursor-pointer items-center border-b-2 px-[12px]',
              active
                ? 'border-accent text-accent font-semibold'
                : 'text-t2 border-transparent font-medium',
            )}
          >
            {LABEL[id]}
          </button>
        )
      })}
    </nav>
  )
}
