import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const readSource = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')
const readKit = (path: string) =>
  readFileSync(new URL(`../../../../../../packages/kit/src/${path}`, import.meta.url), 'utf8')

describe('editor dock chrome', () => {
  test('separates docked editor regions with rules instead of underlays', () => {
    const statusBar = readSource('EditorStatusBar.tsx')
    const statusBarPrimitive = readKit('layout/workbench-statusbar.tsx')
    const breadcrumbPrimitive = readKit('layout/workbench-breadcrumb.tsx')
    const sources = [
      readSource('SymbolBreadcrumbBar.tsx'),
      statusBar,
      statusBarPrimitive,
      breadcrumbPrimitive,
    ].join('\n')

    // A rule is a hairline on one side, on a border STEP (full, soft or faint) — never an
    // underlay fill. The step names replaced hand-picked alphas, so the check names the family.
    const rule = (side: 'l' | 'b' | 't') =>
      new RegExp(`border-${side} border-border(?:-soft|-faint)?(?![\\w/-])`, 'u')
    expect(sources).toMatch(rule('b'))
    expect(sources).toContain('border-t')
    expect(statusBar).toContain('WorkbenchStatusBar')
    expect(readSource('SymbolBreadcrumbBar.tsx')).toContain('WorkbenchBreadcrumb')
    expect(sources).not.toContain('bg-surface/40')
    expect(sources).not.toContain('bg-surface/50')
  })
})
