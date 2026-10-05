import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL(`./${path}`, import.meta.url), 'utf8')
const source = read('CapabilitiesSettings.tsx')
const tabRow = read('capabilities/CapabilityTabRow.tsx')
const scaffold = read('SettingsScaffold.tsx')

/**
 * Every sub-tab the Capabilities page can show.
 *
 * `AgentsSettings` is NOT one any more: agents became a primary tab of their own, and a
 * primary tab owns its page frame — that is how every other one (General, Editor,
 * Preferences) states its title. Leaving it here made the rule below forbid the heading it
 * is now supposed to have.
 */
const SUB_TABS = [
  'ToolsSettings.tsx',
  'SkillsSettings.tsx',
  'McpSettings.tsx',
  'PluginsSettings.tsx',
] as const

/** The sub-tabs that are a list of records with an add/edit form. */
const REGISTRY_TABS = ['SkillsSettings.tsx', 'McpSettings.tsx', 'PluginsSettings.tsx'] as const

test('capability tabs do not prefetch every registry for decorative badges', () => {
  expect(source).not.toContain('backendClient.')
  expect(source).not.toContain('Promise.allSettled')
  expect(source).not.toContain('startStartupRetry')
  expect(source).not.toContain('badge:')
})

describe('one page frame', () => {
  test('the page heading comes from the shared scaffold, not a local copy', () => {
    expect(source).toContain('<SettingsPageHeader')
    // The type scale lives with the component that owns every settings heading.
    expect(scaffold).toContain('text-xl font-semibold')
    expect(scaffold).toContain('text-balance')
    for (const marker of ['text-xl font-semibold', '<h2']) {
      expect(source, `CapabilitiesSettings.tsx restates ${marker}`).not.toContain(marker)
    }
  })

  test('no sub-tab opens a page frame of its own', () => {
    // Switching tabs must not move the title or change the gutters, so a sub-tab
    // renders a BODY — never a second page heading.
    for (const file of SUB_TABS) {
      const tab = read(file)
      expect(tab, `${file} restates the page heading scale`).not.toContain('text-xl font-semibold')
      expect(tab, `${file} renders its own page frame`).not.toContain('SettingsPage')
    }
  })
})

describe('one seam, no hand-nudged alignment', () => {
  test('the row draws no seam of its own — TabBar owns the only one', () => {
    const tabs = readFileSync(
      new URL('../../../../../../packages/kit/src/layout/tabs/tabs.tsx', import.meta.url),
      'utf8',
    )
    // TabBar's own row, not the editor TabStrip above it — they are different rows.
    const tabBarSeam = tabs
      .slice(tabs.indexOf('export function TabBar'))
      .match(/border-b border-border(?:-[a-z]+|\/\d+)/)?.[0]
    expect(tabBarSeam).toBe('border-b border-border-soft')
    // TabBar now takes the trailing control INTO its row, so its seam already runs
    // the full width. This file used to suppress that seam and redraw it on a
    // wrapper — two declarations of one line, which is what drifted.
    expect(tabRow).not.toContain('border-b')
    expect(tabRow).not.toContain('border-b-0')
    expect(tabRow).toContain('trailing=')
  })

  test('the page draws no seam of its own', () => {
    expect(source).not.toContain('border-b')
    expect(source).not.toContain('border-border')
  })

  test('the trailing control is aligned structurally, not by a padding nudge', () => {
    // `items-end` plus a hand-tuned `pb-1.5` on the picker is what this replaced:
    // a number measured against the tab strip's own padding, silently wrong the
    // moment either control changed height.
    expect(tabRow).not.toMatch(/\bp[btxy]?-\d/)
    expect(tabRow).not.toContain('items-end')
    // TabBar's row is one token band and centres its trailing slot itself, so the
    // page states no height and no vertical padding at all.
    expect(tabRow).not.toMatch(/\bh-/)
    expect(source).not.toContain('<TabBar')
  })

  test('there is no project picker — every list shows everything visible from here', () => {
    // The last control that decided what you may see from where a file happens to live.
    // Discovery merges your own artifacts with the project's, so there is nothing to switch
    // between; where a NEW one is installed is the installing form's question, not a filter
    // sitting above every list.
    expect(source).not.toContain('ProjectSwitcher')
    expect(source).not.toContain('SCOPELESS_TABS')
  })

  test('the agent picker is unconditional — every switch on this page writes a rule', () => {
    // It was conditional once, on the claim that Skills, MCP and Plugins are "about what is
    // installed, not about rules". They are both: their switches write `skill:`, `mcp:` and
    // `plugin:` rules, in the same vocabulary as `tool:`. Hiding the picker there did not
    // remove the question — it sent the answer to the default assistant without saying so.
    expect(source).toContain('<AgentSwitcher')
    expect(source).not.toMatch(/[&?]\s*<AgentSwitcher/)
    expect(source).not.toContain('ProjectSwitcher')
  })
})

describe('registry tabs share one body shape', () => {
  test('every registry tab composes the shared section and registry body', () => {
    for (const file of REGISTRY_TABS) {
      const tab = read(file)
      expect(tab, `${file} skips SettingsSection`).toContain('<SettingsSection')
      expect(tab, `${file} skips CapabilityRegistryBody`).toContain('<CapabilityRegistryBody')
    }
  })

  test('no registry tab restates the load/empty/rows ladder', () => {
    // The four states (loading, settled-empty, rows, silence) are decided once, in
    // CapabilityRegistryBody — a per-tab copy is how "no plugins here yet" ends up
    // printed under a failed load.
    for (const file of REGISTRY_TABS) {
      const tab = read(file)
      for (const marker of [
        'shouldShowRegistryEmptyState',
        '<LoadingHint',
        '<EmptyHint',
        '<SettingRegistryList',
      ]) {
        expect(tab, `${file} restates ${marker}`).not.toContain(marker)
      }
    }
  })
})
