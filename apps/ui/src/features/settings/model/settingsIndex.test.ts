import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SETTINGS_INDEX } from './settingsIndex'
import { CAPABILITY_TABS } from '@/shared/routing/routes'

/**
 * Anti-drift guard for the hand-maintained settings search index.
 *
 * An index derived from the rendered UI could not drift; ours is hand-written, so
 * this test statically scans the settings UI
 * source for every section anchor (`<SettingsSection anchor="…">` and raw
 * `data-settings-anchor="…"`) and asserts each one is reachable through at least
 * one SETTINGS_INDEX entry. If someone adds a settings section but forgets to
 * index it — or deletes an index entry that a rendered section relies on — this
 * fails, keeping the search box in lock-step with what the UI actually renders.
 */

const UI_DIR = join(import.meta.dir, '..', 'ui')

/** Recursively collect every `*.tsx` file under the settings UI directory. */
function collectTsxFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collectTsxFiles(full))
    else if (entry.name.endsWith('.tsx')) out.push(full)
  }
  return out
}

/** Every section anchor literal the settings UI renders. */
function renderedAnchors(): Set<string> {
  const anchors = new Set<string>()
  // Matches both `anchor="foo"` (SettingsSection prop) and the raw
  // `data-settings-anchor="foo"` attribute — SettingsSection forwards the former
  // to the latter, so either form is a real, scrollable section.
  const re = /(?:data-settings-)?anchor="([a-z0-9-]+)"/g
  for (const file of collectTsxFiles(UI_DIR)) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(re)) anchors.add(m[1])
  }
  return anchors
}

describe('settings index anti-drift', () => {
  it('finds at least a handful of rendered anchors (scan sanity check)', () => {
    // Guards against a broken scan silently passing every other assertion.
    expect(renderedAnchors().size).toBeGreaterThan(8)
  })

  it('every rendered settings anchor is reachable from SETTINGS_INDEX', () => {
    const indexed = new Set(
      SETTINGS_INDEX.map((e) => e.anchor).filter((a): a is string => Boolean(a)),
    )
    const missing = [...renderedAnchors()].filter((a) => !indexed.has(a)).sort()
    expect(missing).toEqual([])
  })

  it('every capability tab has an index entry', () => {
    const indexedTabs = new Set(SETTINGS_INDEX.map((e) => e.tab))
    const missing = CAPABILITY_TABS.filter((t) => !indexedTabs.has(t))
    expect(missing).toEqual([])
  })

  it('every index anchor points at a real rendered section', () => {
    const rendered = renderedAnchors()
    const dangling = SETTINGS_INDEX.map((e) => e.anchor)
      .filter((a): a is string => Boolean(a))
      .filter((a) => !rendered.has(a))
      .sort()
    expect(dangling).toEqual([])
  })
})
