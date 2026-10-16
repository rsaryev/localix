import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MonogramAvatar } from './monogram-avatar'
import { avatarHue } from './avatar-seed'

const markup = (node: React.ReactElement) => renderToStaticMarkup(node)

describe('MonogramAvatar', () => {
  test('composes the colour on the element, not in a :root token', () => {
    // The defect this pins: a custom property's `var()` references are substituted where the
    // property is DECLARED. A finished `--avatar-tile: oklch(… var(--avatar-hue))` on `:root`
    // resolves the hue against `:root`, which has none, so every agent inherits the fallback
    // colour — a roster of identical tiles, the one thing the tile exists to avoid.
    const html = markup(<MonogramAvatar identity="implementer" />)
    expect(html).toContain(`--avatar-hue:${avatarHue('implementer')}`)
    expect(html).toContain('background-color:oklch(var(--avatar-tile-l)')
    expect(html).toContain('var(--avatar-hue))')
  })

  test('two agents get two hues, and the colour survives a rename', () => {
    const one = markup(<MonogramAvatar identity="reviewer" />)
    const two = markup(<MonogramAvatar identity="researcher" />)
    expect(one).not.toBe(two)
    expect(markup(<MonogramAvatar identity="reviewer" label="Diff Inspector" />)).toContain(
      `--avatar-hue:${avatarHue('reviewer')}`,
    )
  })

  test('lightness and chroma come from the theme, never from here', () => {
    // Literal numbers would be a light-theme tile on the dark shell. The four scalars are
    // declared once per theme in app/index.css; this file names them and nothing else.
    const html = markup(<MonogramAvatar identity="localix" />)
    for (const token of ['--avatar-tile-l', '--avatar-tile-c', '--avatar-ink-l', '--avatar-ink-c'])
      expect(html).toContain(`var(${token})`)
    expect(html).not.toMatch(/oklch\(0/)
  })

  test('is decorative — the agent is named in text beside it', () => {
    expect(markup(<MonogramAvatar identity="localix" label="Localix" />)).toContain(
      'aria-hidden="true"',
    )
  })
})
