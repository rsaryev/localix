import { describe, expect, test } from 'bun:test'
import { isChartParsable, normalizeColor, type ColorResolver } from './cssColor'

describe('isChartParsable', () => {
  test('the syntaxes the chart understands', () => {
    for (const ok of [
      '#fff',
      '#26a69a',
      '#26a69aff',
      'rgb(1, 2, 3)',
      'rgba(1,2,3,0.5)',
      'hsl(0 0% 0%)',
      'hsla(0,0%,0%,.5)',
      'red',
      'transparent',
    ]) {
      expect(isChartParsable(ok)).toBe(true)
    }
  })

  test('a modern colour function is exactly what must NOT pass', () => {
    // The whole bug: the chart's parser throws on these, and the browser hands them back verbatim.
    for (const bad of [
      'oklch(0.68 0.19 18)',
      'oklab(0.4 0.2 -0.1)',
      'lch(50% 40 30)',
      'color(srgb 1 0 0)',
      'color-mix(in oklch, red, blue)',
      'var(--x)',
      '',
    ]) {
      expect(isChartParsable(bad)).toBe(false)
    }
  })
})

describe('normalizeColor', () => {
  /** A browser that paints the colour and hands back real channels — what canvas does once you read
   *  the pixel rather than trusting `fillStyle` to convert. */
  const paints: ColorResolver = (value) => (value.startsWith('oklch(') ? 'rgb(38, 166, 154)' : null)

  test('an oklch theme token becomes something the chart can parse', () => {
    expect(normalizeColor('oklch(0.74 0.16 155)', '#ef5350', paints)).toBe('rgb(38, 166, 154)')
  })

  test('a value the chart already understands is not round-tripped', () => {
    const never: ColorResolver = () => {
      throw new Error('must not be called')
    }
    expect(normalizeColor('#26A69A', '#000000', never)).toBe('#26A69A')
  })

  test('a resolver that echoes an unparsable colour does NOT count as resolved', () => {
    // The first version of this module shipped exactly this bug: `fillStyle` round-trips `oklch()`
    // verbatim, the fake resolver agreed, the tests passed, and the chart still crashed.
    const echoes: ColorResolver = (value) => value
    expect(normalizeColor('oklch(0.68 0.19 18)', '#ef5350', echoes)).toBe('#ef5350')
  })

  test('a blank var falls back — an unset token is not a colour', () => {
    expect(normalizeColor('', '#ef5350', paints)).toBe('#ef5350')
    expect(normalizeColor('   ', '#ef5350', paints)).toBe('#ef5350')
  })

  test('an unparsable value falls back rather than reaching the chart', () => {
    expect(normalizeColor('var(--nope)', '#ef5350', paints)).toBe('#ef5350')
  })

  test('the fallback runs the same gauntlet — one the chart cannot parse is no fallback', () => {
    expect(normalizeColor('', 'oklch(0.74 0.16 155)', paints)).toBe('rgb(38, 166, 154)')
    const echoes: ColorResolver = (value) => value
    expect(normalizeColor('nonsense(1)', 'oklch(0.7 0 0)', echoes)).toBe('nonsense(1)')
  })

  test('when nothing survives, the value comes back verbatim so the failure is loud', () => {
    const none: ColorResolver = () => null
    expect(normalizeColor('oklch(0.74 0.16 155)', 'oklch(0.5 0 0)', none)).toBe(
      'oklch(0.74 0.16 155)',
    )
  })
})
