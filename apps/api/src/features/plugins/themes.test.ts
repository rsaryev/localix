import { describe, expect, test } from 'bun:test'
import { parseTheme, type ClaudeTheme } from '@localixai/claude-plugin'

import type { PluginCatalog, PluginCatalogEntry } from './catalog'
import { CC_THEME_TOKEN_VARS, listThemesFromCatalog, toLocalixTheme } from './themes'

const dracula = parseTheme('dracula', {
  name: 'Dracula',
  base: 'light-daltonized',
  overrides: {
    claude: '#bd93f9',
    error: 'ansi:redBright',
    success: 'rgb(80,250,123)',
    planMode: '#38bdf8',
    purple_FOR_SUBAGENTS_ONLY: '#ff79c6',
    diffAdded: '#14532d',
    diffRemoved: '#7f1d1d',
    diffAddedWord: '#166534',
    diffRemovedWord: '#991b1b',
    userMessageBackground: '#1e1b4b',
    selectionBg: '#44475a',
    inverseText: '#000000',
  },
})!

describe('toLocalixTheme', () => {
  test('maps each Claude Code token onto the CSS properties that draw its role', () => {
    expect(toLocalixTheme('vamp', dracula)).toEqual({
      id: 'vamp:dracula',
      pluginName: 'vamp',
      name: 'Dracula',
      // A daltonized or ANSI preset starts from its light or dark tone.
      base: 'light',
      overrides: {
        '--composer-accent': '#bd93f9',
        '--status-error': '#ff0000',
        '--destructive': '#ff0000',
        '--status-success': '#50fa7b',
        '--conn-violet': '#ff79c6',
        '--diff-added': '#14532d',
        '--diff-removed': '#7f1d1d',
        '--diff-added-word': '#166534',
        '--diff-removed-word': '#991b1b',
        '--user-message': '#1e1b4b',
        '--selection': '#44475a',
        '--primary-foreground': '#000000',
      },
    })
  })

  test('a token Localix draws nothing for is dropped, as Claude Code drops an unknown one', () => {
    expect(CC_THEME_TOKEN_VARS.planMode).toBeUndefined()
    expect(Object.values(toLocalixTheme('vamp', dracula).overrides)).not.toContain('#38bdf8')
  })

  test('every mapped property is one both kit themes declare', async () => {
    for (const sheet of ['theme-dark.css', 'theme-light.css']) {
      const css = await Bun.file(
        new URL(`../../../../../packages/kit/styles/${sheet}`, import.meta.url),
      ).text()
      // The light sheet restates only what it retunes; a token it leaves alone inherits the
      // dark sheet's `:root` value, so only the diff washes (tuned per tone) must appear in both.
      const required =
        sheet === 'theme-dark.css'
          ? new Set(Object.values(CC_THEME_TOKEN_VARS).flat())
          : ['--diff-added', '--diff-removed', '--diff-added-word', '--diff-removed-word']
      for (const cssVar of required) expect(css).toContain(`${cssVar}:`)
    }
  })
})

describe('listThemesFromCatalog', () => {
  const entry = (
    name: string,
    scope: 'global' | 'project',
    themes: ClaudeTheme[],
  ): PluginCatalogEntry =>
    ({
      plugin: {
        manifest: { name },
        scope,
        projectId: scope === 'global' ? '' : 'p1',
        entrypoints: { components: { themes } },
      },
    }) as unknown as PluginCatalogEntry
  const catalog = (enabled: PluginCatalogEntry[], all = enabled) =>
    ({ all, enabled, awaitingConsent: [], find: () => undefined }) as PluginCatalog

  test("lists the themes of the scope's enabled plugins, its project plugins included", () => {
    const on = entry('vamp', 'global', [dracula])
    const off = entry('off', 'global', [parseTheme('x', {})!])
    const local = entry('local', 'project', [parseTheme('y', {})!])
    expect(listThemesFromCatalog(catalog([on, local], [on, off, local])).map((t) => t.id)).toEqual([
      'vamp:dracula',
      'local:y',
    ])
  })
})
