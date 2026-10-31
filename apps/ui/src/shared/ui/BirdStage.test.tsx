import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { BirdStage } from './BirdStage'

const windLines = (html: string) => html.match(/wind-sweep/g)?.length ?? 0

describe('the bird stage', () => {
  test('draws the asked number of wind lines, playing the asked number of times', () => {
    const html = renderToStaticMarkup(<BirdStage cycles={Infinity} lineCount={10} />)
    expect(windLines(html)).toBe(10)
    expect(html).toContain('linear infinite forwards')
    expect(html).toContain('bird-drift')
  })

  test('at rest it draws the bird with no wind, drift or intro', () => {
    const html = renderToStaticMarkup(<BirdStage still cycles={Infinity} lineCount={10} />)
    expect(windLines(html)).toBe(0)
    expect(html).not.toContain('bird-drift')
    expect(html).not.toContain('bird-intro')
    expect(html).toContain('mask-image:url(/logo-dark.svg)')
  })
})
