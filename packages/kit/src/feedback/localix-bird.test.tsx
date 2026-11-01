import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { LocalixBird } from './localix-bird'

const windLines = (html: string) => html.match(/wind-sweep/g)?.length ?? 0
/** The eye's main red, as in the bird's artwork. */
const EYE_RED = '#b9170a'

describe('the Localix bird', () => {
  test('flies: it drifts while the asked number of wind lines sweep past, forever if asked', () => {
    const html = renderToStaticMarkup(
      <LocalixBird src="/bird.svg" cycles={Infinity} lineCount={7} />,
    )
    expect(windLines(html)).toBe(7)
    expect(html).toContain('linear infinite forwards')
    expect(html).toContain('bird-drift')
    expect(html).toContain('bird-intro')
  })

  test('keeps its red eye, which the one-colour mask the bird is painted through would lose', () => {
    const html = renderToStaticMarkup(<LocalixBird src="/bird.svg" />)
    expect(html).toContain('mask-image:url(/bird.svg)')
    expect(html).toContain(`fill="${EYE_RED}"`)
  })

  test('at rest it keeps the bird and its eye, with no wind, drift or intro', () => {
    const html = renderToStaticMarkup(<LocalixBird src="/bird.svg" still lineCount={7} />)
    expect(windLines(html)).toBe(0)
    expect(html).not.toContain('bird-drift')
    expect(html).not.toContain('bird-intro')
    expect(html).toContain(`fill="${EYE_RED}"`)
  })

  test('is decorative', () => {
    const html = renderToStaticMarkup(<LocalixBird src="/bird.svg" />)
    expect(html).toMatch(/^<[a-z]+ [^>]*aria-hidden="true"/)
  })
})
