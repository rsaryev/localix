import { describe, expect, test } from 'bun:test'
import { boxLook, buttonLook, space, textLook } from './modStyle'

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
  test('sizes are relative to the site; bold is medium, never heavy', () => {
    expect(textLook({ size: 'body' }, 'band').tier).toBe('text')
    expect(textLook({ size: 'caption' }, 'band').tier).toBe('meta')
    expect(textLook({ size: 'title' }, 'pane').tier).toBe('title')
    expect(textLook({ bold: true }, 'band').weight).toBe('medium')
    expect(textLook({ bold: true }, 'pane').weight).toBe('medium')
    expect(textLook({ weight: 'bold' }, 'band').weight).toBe('medium')
    expect(textLook({ weight: 'bold' }, 'pane').weight).toBe('semibold')
    expect(textLook({ weight: 'medium' }, 'pane').weight).toBe('medium')
  })

  test('a pane draws a terminal’s text on its grid, in the code face; the band is chrome', () => {
    expect(textLook({}, 'pane').mono).toBe(true)
    expect(textLook({ size: 'title' }, 'pane').mono).toBe(false)
    expect(textLook({}, 'band').mono).toBe(false)
    expect(textLook({ mono: true }, 'band').mono).toBe(true)
  })

  test('dim text is one step quieter than the site’s own text', () => {
    expect(textLook({ dimColor: true }, 'band').tone).toBe('faint')
    expect(textLook({ dimColor: true }, 'pane').tone).toBe('soft')
    const dim = textLook({ dimColor: true, italic: true, strikethrough: true }, 'pane')
    expect(dim.italic).toBe(true)
    expect(dim.strikethrough).toBe(true)
  })

  test('inverse is the selected segment, whatever colour the mod named', () => {
    const chip = textLook({ inverse: true, color: 'cyan' }, 'pane')
    expect(chip.chip).toBe(true)
    expect(chip.style.backgroundColor).toBe('var(--surface-active)')
    expect(chip.style.color).toBe('var(--foreground)')
  })

  test('a colour is its tone’s token: toned in the band, the status colour in a pane', () => {
    expect(textLook({ color: 'magenta', bold: true }, 'band').style.color).toBe(
      'color-mix(in oklab, var(--conn-violet) 45%, var(--text-soft))',
    )
    expect(textLook({ color: 'green' }, 'pane').style.color).toBe('var(--status-success)')
    expect(textLook({ color: 'cyan', dimColor: true }, 'pane').tone).toBe(null)
  })
})

describe('boxes', () => {
  test('a row of one-line cells shares their baseline, as on a terminal’s line', () => {
    expect(boxLook({}, 'band').style.alignItems).toBe('baseline')
    expect(boxLook({ alignItems: 'center' }, 'band').style.alignItems).toBe('center')
    expect(boxLook({ flexDirection: 'column' }, 'pane').style.alignItems).toBeUndefined()
  })

  test('a ground is a neutral veil and a coloured frame keeps the border token', () => {
    const look = boxLook(
      { backgroundColor: 'magenta', borderStyle: 'round', borderColor: 'magenta' },
      'pane',
    )
    expect(look.style.backgroundColor).toBe('var(--field-fill)')
    expect(look.style.borderColor).toBeUndefined()
  })
})

describe('buttons at a site’s control rung', () => {
  test('one quiet style per site: ghost in the band, the soft fill in a pane', () => {
    expect(buttonLook({}, 'band')).toMatchObject({ size: 'xs', variant: 'ghost', row: false })
    expect(buttonLook({}, 'pane')).toMatchObject({ size: 'sm', variant: 'secondary', row: false })
    expect(buttonLook({ plain: true }, 'pane')).toMatchObject({ variant: 'ghost', row: true })
    expect(buttonLook({ variant: 'primary' }, 'band').variant).toBe('mono')
    expect(buttonLook({ variant: 'danger' }, 'band').variant).toBe('destructive')
  })

  test('in a pane’s action bar a plain button is one of the bar’s buttons, not a row', () => {
    expect(buttonLook({ plain: true }, 'pane', true)).toMatchObject({
      variant: 'secondary',
      row: false,
    })
  })
})
