import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
})

afterAll(async () => {
  await teardown()
})

function Glyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path d="M4 4h16v16H4z" />
    </svg>
  )
}

describe('glyphSvg', () => {
  test('renders the rail icon as a sized, light, standalone SVG', async () => {
    const { glyphSvg } = await import('./appIcon')
    const markup = glyphSvg(Glyph)
    const svg = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement
    expect(svg.getAttribute('xmlns')).toBe('http://www.w3.org/2000/svg')
    expect(svg.getAttribute('width')).toBe('400')
    expect(svg.getAttribute('stroke')).toBe('#e7e6e6')
    expect(svg.getAttribute('stroke-width')).toBe('1.5')
    expect(svg.getAttribute('class')).toBeNull()
    expect(markup).not.toContain('currentColor')
  })

  test('an icon that draws no SVG is an error, not a blank app icon', async () => {
    const { glyphSvg } = await import('./appIcon')
    expect(() => glyphSvg(() => <span />)).toThrow('did not render an SVG')
  })
})
