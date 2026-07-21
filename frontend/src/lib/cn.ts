import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * The design system's font sizes, as declared in `index.css`'s `@theme` block.
 *
 * These MUST be listed here. tailwind-merge classifies an unknown `text-*`
 * class by guessing, and `text-115` does not look like a font size to it — no
 * t-shirt size, no unit — so it lands in the same conflict group as the colour
 * utilities. `cn('text-115', 'text-t1')` therefore silently dropped
 * `text-115`, and the element rendered at the inherited 13px. It is invisible
 * in review because the class does not error, it just disappears from the
 * emitted string.
 *
 * Any new `--text-*` token has to be added here as well.
 */
const FONT_SIZES = [
  '8',
  '85',
  '9',
  '95',
  '98',
  '10',
  '105',
  '11',
  '115',
  '12',
  '125',
  '13',
  '14',
  '20',
  '24',
] as const

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: [...FONT_SIZES] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
