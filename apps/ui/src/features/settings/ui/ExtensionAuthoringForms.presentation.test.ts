import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL(`./${path}`, import.meta.url), 'utf8')
/** A surface is its tab plus the `capabilities/` parts that render it. */
const readSurface = (paths: readonly string[]) => paths.map(read).join('\n')

const authoringForms: ReadonlyArray<readonly [string, readonly string[]]> = [
  [
    'Agents',
    [
      'AgentsSettings.tsx',
      'capabilities/AgentRow.tsx',
      'agent-profile/AgentProfileTab.tsx',
      'capabilities/agent-editor/AgentEditor.tsx',
      'capabilities/agent-editor/AgentModelField.tsx',
    ],
  ],
  ['Install', ['InstallForm.tsx']],
  ['Marketplaces', ['MarketplacesPanel.tsx']],
  ['Plugin config', ['SettingsConfigForm.tsx']],
  ['Skills', ['SkillsSettings.tsx', 'capabilities/SkillForm.tsx', 'capabilities/SkillRow.tsx']],
]

const actionPanels: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['Plugins', ['PluginsSettings.tsx', 'capabilities/PluginRow.tsx']],
]

describe('extension authoring form presentation contract', () => {
  test.each(authoringForms)('%s uses shared fields and controls', (_name, paths) => {
    const source = readSurface(paths)

    expect(source).toContain('<Field')
    expect(source).toContain('<Input')
    expect(source).not.toContain("from './formStyles'")
    expect(source).not.toContain('<input')
    expect(source).not.toContain('<textarea')
    expect(source).not.toContain('<button')
  })

  test.each(actionPanels)('%s uses shared buttons without legacy form styles', (_name, paths) => {
    const source = readSurface(paths)

    expect(source).toContain('<Button')
    expect(source).not.toContain("from './formStyles'")
    expect(source).not.toContain('<button')
  })

  test('multi-line authoring fields use the shared Textarea primitive', () => {
    expect(read('capabilities/agent-editor/AgentEditor.tsx')).toContain('<Textarea')
    expect(read('capabilities/SkillForm.tsx')).toContain('<Textarea')
  })

  /**
   * Every record editor speaks through the same chrome (`SettingsRecordChrome`), whether its
   * shell is the drawer the short records open in or the page an agent's profile is. The chrome
   * owns the alert region, so the rule splits in two: it states the failure accessibly, and a
   * form reaches it by HANDING its failure over — which is also what stops a form from quietly
   * growing a second, differently-styled error line of its own.
   */
  const shellEditors = [
    'capabilities/agent-editor/AgentEditor.tsx',
    'capabilities/SkillForm.tsx',
    'capabilities/McpServerForm.tsx',
    'InstallForm.tsx',
  ] as const

  test('the shared record editor exposes actionable failures to assistive technology', () => {
    expect(read('SettingsRecordChrome.tsx')).toContain('role="alert"')
    // Both shells reach it through the chrome — neither draws a row of its own.
    for (const shell of ['SettingsRecordEditor.tsx', 'SettingsRecordPage.tsx']) {
      expect(read(shell), `${shell} skips the shared status row`).toContain('<RecordEditorStatus')
      expect(read(shell), `${shell} draws an alert of its own`).not.toContain('role="alert"')
    }
    for (const file of shellEditors) {
      expect(read(file), `${file} must hand its failure to the editor`).toMatch(/\berror=\{/)
      expect(read(file), `${file} draws an error line of its own`).not.toContain('role="alert"')
    }
  })

  test.each(authoringForms.filter(([name]) => name === 'Marketplaces'))(
    '%s exposes actionable failures to assistive technology',
    (_name, paths) => expect(readSurface(paths)).toContain('role="alert"'),
  )
})
