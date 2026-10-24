import { describe, expect, test } from 'bun:test'
import { boxLook, buttonLook, colorOf, space, textLook } from './modStyle'

describe('spacing at a site’s density', () => {
  test('a cell across and down is a fixed step per site', () => {
    expect(space(1, 'band', 'x')).toBe('4px')
    expect(space(1, 'band', 'y')).toBe('2px')
    expect(space(1, 'pane', 'x')).toBe('6px')
    expect(space(1, 'pane', 'y')).toBe('4px')
  })

  test('a margin drawn for an 80-column terminal is clamped, not an indent across the box', () => {
    expect(space(20, 'band', 'x')).toBe('12px')
    expect(space(40, 'pane', 'x')).toBe('24px')
  })

  test('a step name maps onto the kit spacing steps', () => {
    expect(space('md', 'band', 'x')).toBe('6px')
    expect(space('md', 'pane', 'x')).toBe('8px')
    expect(space('nonsense', 'pane', 'x')).toBeUndefined()
  })

  test('a box keeps its direction and alignment, and draws no ASCII frame', () => {
    const look = boxLook(
      { flexDirection: 'column', marginLeft: 2, borderStyle: 'round', alignItems: 'center' },
      'band',
    )
    expect(look.style.flexDirection).toBe('column')
    expect(look.style.alignItems).toBe('center')
    expect(look.style.marginLeft).toBe('8px')
    expect(look.framed).toBe('hairline')
    expect(boxLook({ borderStyle: 'double' }, 'pane').framed).toBe('strong')
    expect(boxLook({ borderStyle: 'quote' }, 'pane').framed).toBe('quote')
    expect(boxLook({}, 'pane').framed).toBe(null)
  })
})

describe('text at a site’s tier', () => {
  test('sizes are relative to the site, and bold is never heavier than the site allows', () => {
    expect(textLook({ size: 'body' }, 'band').tier).toBe('text')
    expect(textLook({ size: 'caption' }, 'band').tier).toBe('meta')
    expect(textLook({ size: 'title' }, 'pane').tier).toBe('title')
    expect(textLook({ bold: true }, 'band').weight).toBe('medium')
    expect(textLook({ weight: 'bold' }, 'pane').weight).toBe('semibold')
    expect(textLook({ weight: 'medium' }, 'pane').weight).toBe('medium')
  })

  test('dim, italic, struck-through and inverse text keep their meaning', () => {
    const dim = textLook({ dimColor: true, italic: true, strikethrough: true }, 'pane')
    expect(dim.tone).toBe('soft')
    expect(dim.italic).toBe(true)
    expect(dim.strikethrough).toBe(true)
    const chip = textLook({ inverse: true, color: 'green' }, 'pane')
    expect(chip.chip).toBe(true)
    expect(chip.style.color).toBe('var(--status-success)')
  })

  test('the band mutes a coloured text toward the strip’s soft tone', () => {
    const look = textLook({ color: 'magenta', bold: true }, 'band')
    expect(look.style.color).toBe('color-mix(in oklab, var(--conn-violet) 70%, var(--text-soft))')
    expect(look.weight).toBe('medium')
  })
})

describe('colours as theme tokens', () => {
  test('terminal names map to the fixed palette', () => {
    expect(colorOf('red')).toBe('var(--status-error)')
    expect(colorOf('yellowBright')).toBe('var(--status-warning)')
    expect(colorOf('cyan')).toBe('var(--chart-2)')
    expect(colorOf('gray')).toBe('var(--text-faint)')
  })

  test('a hex or rgb colour lands on the palette entry nearest its hue', () => {
    expect(colorOf('#ff3b30')).toBe('var(--status-error)')
    expect(colorOf('#34c759')).toBe('var(--status-success)')
    expect(colorOf('rgb(0, 122, 255)')).toBe('var(--status-info)')
    expect(colorOf('#c040ff')).toBe('var(--conn-violet)')
    expect(colorOf('#808080')).toBe('var(--text-faint)')
    expect(colorOf('#f5f5f5')).toBe('var(--foreground)')
    expect(colorOf('url(evil)')).toBeUndefined()
  })
})

describe('buttons at a site’s control rung', () => {
  test('a default button is a compact field button, plain a quiet row, primary and danger kept', () => {
    expect(buttonLook({}, 'band')).toMatchObject({ size: 'xs', variant: 'field', row: false })
    expect(buttonLook({}, 'pane')).toMatchObject({ size: 'sm', variant: 'field', row: false })
    expect(buttonLook({ plain: true }, 'pane')).toMatchObject({ variant: 'ghost', row: true })
    expect(buttonLook({ variant: 'primary' }, 'band').variant).toBe('mono')
    expect(buttonLook({ variant: 'danger' }, 'band').variant).toBe('destructive')
  })
})
