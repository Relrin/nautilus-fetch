interface NautilusMarkProps {
  size?: number
  className?: string
  /** Empty states draw the shell in a muted border colour. */
  stroke?: string
}

/** The wordmark's shell: a ring with a heavier quarter-arc. */
export function NautilusMark({
  size = 19,
  className,
  stroke = 'var(--ndm-accent)',
}: NautilusMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <circle cx="9" cy="9" r="7.5" stroke={stroke} strokeWidth="1.5" />
      <path
        d="M9 1.5 A7.5 7.5 0 0 1 16.5 9"
        stroke={stroke}
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}
