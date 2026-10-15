import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const picker = readFileSync(new URL('./EnvironmentPicker.tsx', import.meta.url), 'utf8')
const sidebar = readFileSync(new URL('../RestApiSidebar.tsx', import.meta.url), 'utf8')
const headerActions = readFileSync(new URL('./RequestsHeaderActions.tsx', import.meta.url), 'utf8')

describe('environment picker chrome', () => {
  test('keeps the environment action in the header so narrow filters cannot wrap it to a row', () => {
    const headerStart = sidebar.indexOf('<PanelHeader')
    const filterStart = sidebar.indexOf('<WorkbenchToolbar', headerStart)
    // The header's actions live in `RequestsHeaderActions`, which owns the picker.
    expect(sidebar.slice(headerStart, filterStart)).toContain('<RequestsHeaderActions')
    expect(sidebar.slice(filterStart)).not.toContain('<RequestsHeaderActions')
    expect(headerActions).toContain('<EnvironmentPicker')
    expect(sidebar).not.toContain('<EnvironmentPicker')
    expect(sidebar).not.toContain('<WorkbenchFilterBar')
    expect(sidebar).toContain('density="compact"')
    expect(sidebar).toContain('aria-label="Request filter controls"')
    expect(sidebar).not.toContain(
      'className="flex items-center gap-1.5 border-b border-border-soft p-2"',
    )
    expect(sidebar).not.toContain('className="space-y-2 border-b border-border-soft p-2"')
  })

  test('keeps selection and management inside one compact menu', () => {
    // A pick is a menu of `selected` rows built by the ONE list the titlebar item shares — not a
    // Radix radio group whose rows fold the variable count into the environment's name.
    expect(picker).toContain('environmentEntries(')
    expect(picker).toContain('<MenuEntries')
    expect(picker).not.toContain('<DropdownMenuRadioGroup')
    expect(picker).not.toContain('vars')
    expect(picker).toContain('Manage environments…')
    expect(picker).not.toContain('No environments — literal URLs still work.')
  })
})
