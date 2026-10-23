import { describe, expect, test } from 'bun:test'

import { hostThemeVariablesToCss } from './theme'

describe('host theme sandbox contract', () => {
  test('serializes only allow-listed semantic variables', () => {
    const css = hostThemeVariablesToCss({
      '--background': '#111',
      '--foreground': '#eee',
      '--not-a-host-token': 'leak',
    } as Parameters<typeof hostThemeVariablesToCss>[0])

    expect(css).toContain('--background:#111;')
    expect(css).toContain('--foreground:#eee;')
    expect(css).not.toContain('not-a-host-token')
  })
})
