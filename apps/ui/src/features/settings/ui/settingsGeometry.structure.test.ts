import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const uiDir = import.meta.dir
const read = (name: string) => readFileSync(join(uiDir, name), 'utf8')

const sourceFiles = () => {
  const out: string[] = []
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(join(dir, entry.name), rel)
      else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) out.push(rel)
    }
  }
  walk(uiDir, '')
  return out
}

describe('settings geometry', () => {
  test('reflows on the settings PANE width, not the viewport', () => {
    // SettingsPanel renders every section inside one `@container`, and the pane can be
    // narrow on a wide screen (it is an inspector pane). A viewport breakpoint
    // (`sm:` / `max-sm:` / `md:`) therefore reflows at the wrong moment; container
    // variants (`@md:` / `@max-md:`) are the contract.
    const offenders: string[] = []
    for (const file of sourceFiles()) {
      // The record editor is the one surface here that is NOT pane content: it is portalled
      // to the document as a drawer, so it reflows on the viewport by construction — and its
      // width override MUST carry `md:`, because `DrawerContent` caps itself at
      // `md:max-w-205` and an unprefixed measure silently loses at md and up
      // (`shared/ui/drawerWidth.structure.test.ts` is the rule that says so).
      if (file === 'SettingsRecordEditor.tsx') continue
      for (const match of read(file).matchAll(/class[nN]ame=[^\n]*/g)) {
        // `sm:text-*` is typography scale, not layout, and is allowed.
        if (/(?:^|["'\s])(?:max-)?(?:sm|md|lg|xl):(?!text-)/.test(match[0]))
          offenders.push(`${file}: ${match[0].slice(0, 80)}`)
      }
    }
    expect(offenders).toEqual([])
  })

  // The reading column itself is no longer capped anywhere: a panel's width is the one the
  // user gave its pane, and the 'centred literal column' rule of `ui-token-rules.ts` holds that
  // for the app, every bundled plugin and every plugin a person builds.

  test('uses one weight for an in-page divider, distinct from the chrome seam', () => {
    // The faint border step separates content inside a page; the soft step (panel-header.tsx)
    // separates regions. A hand-picked alpha beside them reads as a mistake, not a distinction.
    for (const file of sourceFiles()) {
      expect(read(file), file).not.toMatch(/(?:border|divide)-border\/\d+\b/u)
    }
  })
})
