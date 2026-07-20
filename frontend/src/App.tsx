/**
 * App shell.
 *
 * The 50px bar over a three-column body is fixed for the lifetime of the app —
 * every page swaps only what lives inside the body grid. Scrolling happens
 * inside panes, never on the page itself.
 */
export default function App() {
  return (
    <div className="text-13 grid h-screen min-w-[1280px] grid-rows-[50px_1fr] overflow-hidden">
      <header className="border-b1 bg-bar flex items-center gap-[14px] border-b px-[14px]">
        <div className="flex items-center gap-[9px]">
          <svg width="19" height="19" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <circle cx="9" cy="9" r="7.5" stroke="var(--ndm-accent)" strokeWidth="1.5" />
            <path
              d="M9 1.5 A7.5 7.5 0 0 1 16.5 9"
              stroke="var(--ndm-accent)"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </svg>
          <span className="text-14 font-semibold tracking-[0.3px]">
            NAUTILUS <span className="text-t2 font-normal">DATA</span>
          </span>
        </div>
      </header>

      <div className="grid min-h-0 grid-cols-[292px_minmax(0,1fr)_344px]">
        <aside className="border-b1 bg-bar flex min-h-0 flex-col border-r" />
        <main className="bg-page flex min-h-0 flex-col" />
        <aside className="border-b1 bg-bar flex min-h-0 flex-col border-l" />
      </div>
    </div>
  )
}
