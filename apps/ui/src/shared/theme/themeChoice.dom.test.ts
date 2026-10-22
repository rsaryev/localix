import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

import type { PluginThemeSpec } from './pluginTheme'
import type { ThemeMode } from './useTheme'

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
const paper: PluginThemeSpec = {
  id: 'docs:paper',
  pluginName: 'docs',
  name: 'Paper',
  base: 'light',
  overrides: { '--user-message': '#fdf6e3' },
}

const accent = () => document.documentElement.style.getPropertyValue('--composer-accent')

/** A mode setter that flips the window the way `useTheme` does. */
function recorder() {
  const modes: ThemeMode[] = []
  const setMode = (mode: ThemeMode) => {
    modes.push(mode)
    document.documentElement.dataset.theme = mode === 'light' ? 'light' : 'dark'
  }
  return { modes, setMode }
}

afterEach(async () => {
  const { clearPluginTheme } = await import('./pluginTheme')
  clearPluginTheme()
})

describe('the theme choices', () => {
  test('the picker switches to the base, then lays the theme over it', async () => {
    const { selectTheme, themeChoices } = await import('./themeChoice')
    expect(themeChoices([dracula]).at(-1)).toEqual({
      value: 'plugin:vamp:dracula',
      label: 'Dracula',
      description: 'From vamp',
    })
    const { modes, setMode } = recorder()
    selectTheme('plugin:vamp:dracula', [dracula], setMode)
    expect(modes).toEqual(['dark'])
    expect(accent()).toBe('#bd93f9')
    selectTheme('light', [dracula], setMode)
    expect(modes).toEqual(['dark', 'light'])
    expect(accent()).toBe('')
  })
})

describe('/theme', () => {
  const dark = { themeMode: 'dark' as ThemeMode, resolvedTheme: 'dark' as const }

  test('reads only the command, with or without a name', async () => {
    const { themeCommandArgument } = await import('./themeChoice')
    expect(themeCommandArgument('/theme')).toBe('')
    expect(themeCommandArgument('  /Theme  Dracula ')).toBe('Dracula')
    expect(themeCommandArgument('/themes')).toBeNull()
    expect(themeCommandArgument('change the /theme')).toBeNull()
  })

  test('with no name lists the appearances and the themes, the current one marked', async () => {
    const { runThemeCommand } = await import('./themeChoice')
    const result = runThemeCommand('', {
      themes: [dracula, paper],
      selection: dark,
      chosen: dracula,
    })
    expect(result.kind).toBe('listed')
    expect(result.detail?.split('\n')).toEqual([
      'System',
      'Light',
      'Dark',
      'Dracula (from vamp) — current',
      'Paper (from docs)',
    ])
    // The appearance is current when no listed theme shows.
    expect(
      runThemeCommand('', { themes: [paper], selection: dark, chosen: dracula }).detail,
    ).toContain('Dark — current')
  })

  test('switches by name, ignoring case, to a theme or an appearance', async () => {
    const { runThemeCommand } = await import('./themeChoice')
    const { modes, setMode } = recorder()
    const deps = { themes: [dracula, paper], selection: dark, chosen: null, setMode }
    expect(runThemeCommand('DRACULA', deps)).toEqual({
      kind: 'switched',
      title: 'Theme set to Dracula',
    })
    expect(modes).toEqual(['dark'])
    expect(accent()).toBe('#bd93f9')
    // The id and the bare slug name it too.
    expect(runThemeCommand('docs:paper', deps).kind).toBe('switched')
    expect(modes.at(-1)).toBe('light')
    expect(runThemeCommand('System', deps).title).toBe('Theme set to System')
    expect(modes.at(-1)).toBe('system')
    expect(accent()).toBe('')
  })

  test('an unknown or shared name changes nothing and says why', async () => {
    const { runThemeCommand } = await import('./themeChoice')
    const { modes, setMode } = recorder()
    const twin = { ...dracula, id: 'other:dracula', pluginName: 'other' }
    const deps = { themes: [dracula, twin], selection: dark, chosen: null, setMode }
    expect(runThemeCommand('solarized', deps)).toMatchObject({
      kind: 'unknown',
      title: 'No theme "solarized"',
    })
    expect(runThemeCommand('dracula', deps).title).toContain('use <plugin>:<theme>')
    expect(runThemeCommand('other:dracula', deps).kind).toBe('switched')
    expect(modes).toEqual(['dark'])
  })
})
