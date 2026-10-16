import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const here = resolve(import.meta.dir)
const read = (path: string) => readFileSync(resolve(here, path), 'utf8')

/**
 * The plugin's composer contribution is DECLARED, never drawn.
 *
 * The chips used to be drawn here, and they drifted the way copied recipes drift: they carried the
 * bare `COMPOSER_CHIP` class string on their own `<button>`, which holds the material but not the
 * geometry, so the git chips rendered flat and padless beside the host's own. The branch and the
 * change summary became declarations (`statusItems.ts`) and the host draws them.
 *
 * The worktree pill was the one exception, and it went with worktree isolation: nothing here
 * draws a chip at all now, so a chip that reappears is a decision to make, not a pattern to copy.
 */
describe('the plugin declares its composer contribution rather than drawing it', () => {
  const sources = Object.fromEntries(
    readdirSync(here)
      .filter((name) => name.endsWith('.tsx') || (name.endsWith('.ts') && !name.includes('.test.')))
      .map((name) => [name, read(name)] as const),
  )

  test('the scan is not void — it finds this directory’s modules', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(0)
  })

  test('no file here builds a composer chip of its own', () => {
    for (const [name, source] of Object.entries(sources)) {
      // The class string has no geometry. Composing it by hand is exactly how these chips lost
      // their height and padding.
      expect(source, name).not.toContain('COMPOSER_CHIP')
      // `lx-glass` paints its own rim; a border on top of it is a second edge.
      expect(source, name).not.toContain('border-control-border text-foreground')
      // The module that held the old class string is gone (`884aa3209`). An import of it is a
      // file that cannot resolve, which is how both composer modules sat broken.
      expect(source, name).not.toContain('composerChip')
    }
  })

  test('no file here draws a composer chip, even with the host’s primitive', () => {
    for (const [name, source] of Object.entries(sources)) {
      expect(source, name).not.toContain('<ComposerChip')
    }
  })

  test('nothing names the pre-namespace work-item kind', () => {
    // `'git-workspace'` is the kind the plugin registered BEFORE `assertPluginOwnedIdentity`
    // forced a namespace. Opening it now yields a tab the host has no component for, so every
    // chip and toast action that still spelled it out opened an empty view.
    expect(read('statusItems.ts')).not.toContain("workKind: 'git-workspace'")
    expect(read('../openGitWorkspace.ts')).toContain('GIT_WORKSPACE_KIND')
  })
})
