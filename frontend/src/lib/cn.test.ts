import { describe, expect, it } from 'vitest'

import { cn } from './cn'

/**
 * These guard a failure mode that leaves no trace: tailwind-merge does not
 * error on a class it misclassifies, it just drops it from the output. The
 * element then renders at the inherited size and looks merely "a bit off".
 */
describe('cn — custom font sizes vs custom colours', () => {
  it('keeps both a size and a colour from the same text-* namespace', () => {
    // The exact combination StatTile uses. Before `font-size` was declared,
    // this returned 'font-mono text-t1' and every tile rendered at 13px.
    const result = cn('text-115 font-mono', 'text-t1')
    expect(result).toContain('text-115')
    expect(result).toContain('text-t1')
  })

  it('keeps every declared size alongside a colour', () => {
    const sizes = [
      'text-8',
      'text-85',
      'text-9',
      'text-95',
      'text-98',
      'text-10',
      'text-105',
      'text-11',
      'text-115',
      'text-12',
      'text-125',
      'text-13',
      'text-14',
      'text-20',
      'text-24',
    ]
    for (const size of sizes) {
      expect(cn(size, 'text-danger'), `${size} was dropped`).toContain(size)
    }
  })

  it('still lets a later size override an earlier one', () => {
    // The shrink ladder in StatTile relies on this working normally.
    expect(cn('text-115', 'text-95')).toBe('text-95')
  })

  it('still lets a later colour override an earlier one', () => {
    expect(cn('text-t1', 'text-danger')).toBe('text-danger')
  })

  it('still resolves ordinary conflicts the stock way', () => {
    expect(cn('px-[10px]', 'px-[12px]')).toBe('px-[12px]')
    // `flex` and `hidden` are both display utilities, so collapsing to the
    // last one is correct — the extension must not disturb that.
    expect(cn('flex', 'hidden')).toBe('hidden')
    expect(cn('hidden', 'xl:block')).toBe('hidden xl:block')
  })
})
