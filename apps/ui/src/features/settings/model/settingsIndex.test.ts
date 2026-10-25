import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SETTINGS_INDEX, type SettingsIndexEntry } from '@/shared/lib/settings-index/settingsIndex'
import { SETTINGS_STRING_TABS } from '@/shared/routing/routes'

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
    else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) out.push(full)
  }
  return out
}

const CONTROL_FILES = [
  'PreferencesSettings.tsx',
  'ThemeField.tsx',
  'EditorSettings.tsx',
  'typography/TypographySection.tsx',
  'ContextExclusionsSection.tsx',
  'ResearchSection.tsx',
  'NotificationsSection.tsx',
  'IslandSection.tsx',
] as const
const normalizeTitle = (title: string) =>
  title
    .replace(/[‘’]/g, "'")
    .trim()
    .toLowerCase()

function missingControls(index: readonly SettingsIndexEntry[]): string[] {
  const titles = new Set(index.map((entry) => normalizeTitle(entry.title)))
  const missing: string[] = []
  for (const file of CONTROL_FILES) {
    const source = readFileSync(join(UI_DIR, file), 'utf8')
    const controls = [
      ...source.matchAll(
        /<(?:SwitchRow|SettingsControlRow|Field)\b[^>]*?\b(?:title|label)="([^"]+)"/g,
      ),
      ...source.matchAll(/<p className="text-sm font-medium text-foreground">([^<{]+)<\/p>/g),
    ]
    for (const control of controls) {
      if (!titles.has(normalizeTitle(control[1]!))) missing.push(`${file}: ${control[1]}`)
    }
  }
  return missing
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
  it('indexes individual static controls by their visible labels, not only section headings', () => {
    expect(missingControls(SETTINGS_INDEX)).toEqual([])
  })

  it('detects a missing control even when its section is still indexed', () => {
    expect(missingControls(SETTINGS_INDEX.filter((entry) => entry.id !== 'prefs.theme'))).toContain(
      'ThemeField.tsx: Theme',
    )
  })
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

  it('indexes only pages Settings still has: items are managed in the Store', () => {
    const tabs = new Set<string>(SETTINGS_STRING_TABS)
    expect(SETTINGS_INDEX.filter((entry) => !tabs.has(entry.tab)).map((entry) => entry.id)).toEqual(
      [],
    )
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
