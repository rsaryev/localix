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
  test('agent configuration shares section, navigation and paired-field primitives', () => {
    const profile = read('agent-profile/AgentProfileTab.tsx')
    expect(profile).toContain('<SettingsNavigation')
    expect(profile).not.toContain('<CapabilityTabRow')
    expect(read('capabilities/agent-editor/AgentEditor.tsx')).toContain('<SettingsSection')
    for (const file of ['AgentEditor.tsx', 'AgentIdentityFields.tsx', 'AgentModelField.tsx']) {
      const source = read(`capabilities/agent-editor/${file}`)
      expect(source, file).toContain('<SettingsFieldGrid')
      expect(source, file).not.toContain('grid-cols-2')
    }
    expect(read('capabilities/agent-editor/AgentModelField.tsx')).not.toContain(
      'h-[var(--chrome-control-xl)]',
    )
  })
  test('reflows on the settings PANE width, not the viewport', () => {
    // SettingsPanel renders every section inside one `@container`, and the pane can be
    // narrow on a wide screen (it is an inspector pane). A viewport breakpoint
    // (`sm:` / `max-sm:` / `md:`) therefore reflows at the wrong moment; container
    // variants (`@md:` / `@max-md:`) are the contract.
    expect(read('SettingsPanel.tsx')).toContain('<SettingsWorkspace')
    expect(read('agent-profile/AgentProfileTab.tsx')).toContain('<SettingsWorkspace')
    expect(read('SettingsWorkspace.tsx')).toContain('@container w-full')

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

  test('keeps settings chrome on the shared geometry scale', () => {
    // Form inputs share one settings measure; rows share SettingsRow's rhythm.
    expect(read('PreferencesSettings.tsx')).not.toContain('h-9')
    expect(read('SettingsPanel.tsx')).not.toContain('h-8')
    // The record editor's own chrome — header, footer, the decision pair — states no height
    // at all: it is the shared drawer's, and a measure written here would be a second one.
    expect(read('SettingsRecordEditor.tsx')).not.toMatch(/\bh-\d/)
    expect(read('McpToolToggles.tsx')).toContain('min-h-[var(--chrome-control-lg)]')
    expect(read('keyboard/ShortcutRow.tsx')).toContain('h-[var(--chrome-control-lg)]')
    expect(read('keyboard/ShortcutRow.tsx')).not.toContain('py-2.5')
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
    expect(read('SettingsScaffold.tsx')).toContain('border-border-faint')
    expect(read('SettingsScaffold.tsx')).toContain('DIVIDED_LIST')
  })
})
