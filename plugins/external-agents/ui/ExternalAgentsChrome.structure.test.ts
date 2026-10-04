import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const uiRoot = resolve(import.meta.dir)
const read = (path: string) => readFileSync(resolve(uiRoot, path), 'utf8')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return entry === 'node_modules' ? [] : sourceFiles(path)
    return path.endsWith('.tsx') && !path.includes('.test.') ? [path] : []
  })
}

const uiSources = sourceFiles(uiRoot).map((path) => ({ path, source: readFileSync(path, 'utf8') }))

/**
 * The roster's chrome is bought from the workbench primitives, not measured locally. Each rule here
 * is one defect that had shipped: a filter row on its own `px-2`, a statistics scope row on `px-4`,
 * a hand-rolled footer, and container-query grids with no containment context to resolve against.
 */
describe('External Agents workbench geometry', () => {
  test('establishes the containment context the statistics grids reflow to', () => {
    // `@xl:`/`@3xl:` resolve against the nearest `@container` ancestor; without one the dashboard
    // was stuck at its two-column base at every pane width.
    expect(read('ExternalAgentsPanel.tsx')).toContain('@container')
    expect(read('ui/StatsView.tsx')).toMatch(/@(?:xl|3xl):grid-cols-/)
  })

  test('does not repeat the work-item tab name in a panel header', () => {
    const panel = read('ExternalAgentsPanel.tsx')
    expect(panel).not.toContain('<PanelHeader')
    expect(panel).toContain('<WorkbenchToolbar as="header"')
    expect(panel).toContain('<WorkbenchToolbarSection align="end"')
  })

  test('keeps every chrome row on a shared primitive', () => {
    expect(read('ui/RosterFilters.tsx')).toContain('<WorkbenchToolbar layout="stacked"')
    expect(read('ui/StatsView.tsx')).toContain('<WorkbenchToolbar layout="stacked"')
    const footer = read('ui/RosterFooter.tsx')
    expect(footer).toContain('<WorkbenchStatusBar')
    expect(footer).toContain('<WorkbenchStatusItem')
    expect(footer).not.toContain('border-t')
  })

  test('takes toolbar padding and seams from the primitive, never a local override', () => {
    for (const { path, source } of uiSources) {
      const override = source.match(/<WorkbenchToolbar[^>]*className="[^"]*\bpx-[\d.]+/s)?.[0] ?? ''
      expect(`${path}: ${override}`).toBe(`${path}: `)
      // Chrome seams are owned by the primitives; a pane row that draws its own is drift.
      expect(`${path}: ${source}`).not.toContain('border-b border-border-soft px-4')
    }
  })

  test('sizes chrome from the geometry scale instead of ad-hoc heights', () => {
    for (const { path, source } of uiSources) {
      expect(`${path}: ${source}`).not.toMatch(/\b(?:min-)?h-(?:6|7|8|9|10)\b/)
      expect(`${path}: ${source}`).not.toMatch(/\b(?:min-)?h-\[\d+px\]/)
      // Type scale, not arbitrary pixels: `text-2xs` is the badge/caption step.
      expect(`${path}: ${source}`).not.toMatch(/text-\[\d+px\]/)
    }
  })

  test('lets a pane-level empty or error state center in the space it replaces', () => {
    for (const path of ['ExternalAgentsPanel.tsx', 'ui/StatsView.tsx']) {
      const source = read(path)
      for (const hint of source.match(/<(?:Empty|Loading)Hint[^>]*/g) ?? []) {
        expect(`${path}: ${hint}`).toContain('flex-1')
      }
    }
  })
})
