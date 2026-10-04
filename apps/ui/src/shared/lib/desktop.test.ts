import { afterEach, describe, expect, test } from 'bun:test'

import { getDesktopApiPort, getDesktopOAuthPort } from '@localixai/kit/environment'

function setWindow(w: unknown) {
  ;(globalThis as { window?: unknown }).window = w
}
afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

const win = (over: Record<string, unknown> = {}, search = '') => ({
  location: { search, protocol: 'http:' },
  ...over,
})

describe('getDesktopApiPort', () => {
  test('undefined when there is no window (SSR / tests)', () => {
    expect(getDesktopApiPort()).toBeUndefined()
  })

  test('prefers the injected numeric global', () => {
    setWindow(win({ __LOCALIX_API_PORT: 5051 }))
    expect(getDesktopApiPort()).toBe(5051)
  })
  test('falls back to the __api_port query param', () => {
    setWindow(win({}, '?__api_port=6000'))
    expect(getDesktopApiPort()).toBe(6000)
  })

  test('a non-numeric __api_port yields undefined, not NaN', () => {
    setWindow(win({}, '?__api_port=not-a-number'))
    expect(getDesktopApiPort()).toBeUndefined()
  })

  test('no global and no query param → undefined', () => {
    setWindow(win())
    expect(getDesktopApiPort()).toBeUndefined()
  })
})

describe('getDesktopOAuthPort', () => {
  test('undefined without a window', () => {
    expect(getDesktopOAuthPort()).toBeUndefined()
  })

  test('prefers the dedicated OAuth port global', () => {
    setWindow(win({ __LOCALIX_OAUTH_PORT: 1455, __LOCALIX_API_PORT: 5051 }))
    expect(getDesktopOAuthPort()).toBe(1455)
  })

  test('falls back to the API port when no OAuth port is injected', () => {
    setWindow(win({ __LOCALIX_API_PORT: 5051 }))
    expect(getDesktopOAuthPort()).toBe(5051)
  })
})
