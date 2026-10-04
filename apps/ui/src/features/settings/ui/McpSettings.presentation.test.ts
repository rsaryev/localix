import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL(`./${path}`, import.meta.url), 'utf8')
const tab = read('McpSettings.tsx')
const form = [
  read('capabilities/McpServerForm.tsx'),
  read('capabilities/McpServerFields.tsx'),
].join('\n')
const row = read('capabilities/McpServerRow.tsx')
/** The MCP surface is the tab plus the `capabilities/` parts it composes. */
const source = [tab, form, row].join('\n')

describe('MCP registry loading presentation', () => {
  test('uses the shared retry status without a second error empty-state', () => {
    expect(tab).toContain('subject="MCP servers"')
    expect(tab).toContain('onRetry={refresh}')
    expect(tab).toContain('<CapabilityRegistryBody')
    expect(source).not.toContain("Couldn't load MCP servers")
  })

  test('keeps form feedback separate from registry failures', () => {
    expect(form).toContain('error={formError}')
    // The alert region belongs to the chrome every record editor speaks through.
    expect(read('SettingsRecordChrome.tsx')).toContain('role="alert"')
    expect(tab).toContain('useMcpServerForm({ scope, refresh })')
    expect(tab).not.toContain('useMcpServerForm({ scope, setError, refresh })')
    // The list's failure belongs to the tab; the draft's belongs to the panel.
    expect(tab).not.toContain('formError')
  })

  test('uses the shared settings form foundation without a parallel class layer', () => {
    expect(form).toContain('<Field')
    expect(form).toContain('<Input')
    expect(form).toContain('<Textarea')
    expect(form).toContain('aria-label="Add server method"')
    expect(form).toContain('aria-label="Transport"')
    // The decision row — its buttons and the busy state they carry — is the shared editor's.
    expect(form).toContain('busy={saving}')
    expect(read('SettingsRecordEditor.tsx')).toContain('aria-busy={busy || undefined}')
    expect(form).toContain('<p role="status" className="text-xs text-text-soft">')
    expect(source).not.toContain("from './formStyles'")
    expect(source).not.toContain('<input')
    expect(source).not.toContain('<textarea')
    expect(source).not.toContain('<button')
  })

  test('renders every discovered MCP tool as a compact scrollable toggle list', () => {
    expect(row).toContain('st.availableTools ?? st.tools')
    expect(row).toContain('<McpToolToggles')
    expect(tab).toContain('setToolEnabled(s, toolName, enabled)')
    expect(source).not.toContain('Tools: <span')
  })
})
