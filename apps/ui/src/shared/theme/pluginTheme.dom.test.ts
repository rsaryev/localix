import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

import type { PluginThemeSpec } from './pluginTheme'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
})
afterAll(async () => teardown())

const dracula: PluginThemeSpec = {
  id: 'vamp:dracula',
  pluginName: 'vamp',
  name: 'Dracula',
  base: 'dark',
  overrides: { '--composer-accent': '#bd93f9', '--status-error': '#ff5555' },
}

const accent = () => document.documentElement.style.getPropertyValue('--composer-accent')
/** MutationObserver records are delivered as a microtask. */
const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve))

describe('a plugin color theme', () => {
  test('paints its overrides over its base, and steps aside while the other base shows', async () => {
    const { choosePluginTheme, clearPluginTheme, installPluginTheme } =
      await import('./pluginTheme')
    const root = document.documentElement
    root.dataset.theme = 'dark'
    const stop = installPluginTheme()
    try {
      choosePluginTheme(dracula)
      expect(accent()).toBe('#bd93f9')
      expect(root.style.getPropertyValue('--status-error')).toBe('#ff5555')

      root.dataset.theme = 'light'
      await settle()
      expect(accent()).toBe('')

      root.dataset.theme = 'dark'
      await settle()
      expect(accent()).toBe('#bd93f9')

      clearPluginTheme()
      expect(accent()).toBe('')
      expect(localStorage.getItem('sandbox_plugin_theme')).toBeNull()
    } finally {
      stop()
    }
  })

  test('follows the listed themes: an update repaints, an unlisted theme steps aside', async () => {
    const { choosePluginTheme, clearPluginTheme, reconcilePluginTheme } =
      await import('./pluginTheme')
    document.documentElement.dataset.theme = 'dark'
    choosePluginTheme(dracula)
    // No document yet: the stored choice paints, so a reload does not flash the plain base.
    reconcilePluginTheme(undefined)
    expect(accent()).toBe('#bd93f9')

    reconcilePluginTheme([{ ...dracula, overrides: { '--composer-accent': '#ff79c6' } }])
    expect(accent()).toBe('#ff79c6')
    expect(document.documentElement.style.getPropertyValue('--status-error')).toBe('')

    // A scope that does not list it (its plugin disabled, another project open) shows the base…
    reconcilePluginTheme([])
    expect(accent()).toBe('')
    // …and keeps the choice, as Claude Code keeps `custom:<slug>`…
    expect(JSON.parse(localStorage.getItem('sandbox_plugin_theme') ?? 'null')?.id).toBe(
      'vamp:dracula',
    )
    // …so it paints again where it is listed.
    reconcilePluginTheme([{ ...dracula, overrides: { '--composer-accent': '#ff79c6' } }])
    expect(accent()).toBe('#ff79c6')

    clearPluginTheme()
    expect(accent()).toBe('')
    expect(localStorage.getItem('sandbox_plugin_theme')).toBeNull()
    reconcilePluginTheme(undefined)
  })
})
