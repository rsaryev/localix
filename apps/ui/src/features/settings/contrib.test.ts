import { expect, test } from 'bun:test'
import type { MiniAppUiHost, UiAnchorContribution, UiAnchorNode } from '@localixai/mini-app-sdk/ui'
import { registerUi } from './contrib'

function settingsAnchors(): UiAnchorContribution {
  let contribution: UiAnchorContribution | undefined
  const noop = { register: () => true }
  registerUi({
    workItems: noop,
    railSections: noop,
    railViewlets: noop,
    search: noop,
    anchors: {
      register: (value: UiAnchorContribution) => {
        contribution = value
        return true
      },
    },
    resourceRefIcons: noop,
    fileEditors: noop,
    fileFormats: noop,
    sessionEvents: noop,
  } as unknown as MiniAppUiHost)
  return contribution!
}

test('the /open anchor tree lists the sections of a Settings page, and no page of items', () => {
  const anchors = settingsAnchors()
  const rows = anchors.listChildren?.('localix://ui/settings/permissions') as UiAnchorNode[]
  expect(rows.map((row) => row.label)).toContain('Permission rules')
  // Plugins, skills, MCP servers, agents and mini apps are managed in the Store.
  for (const moved of ['plugins', 'skills', 'mcp', 'agents', 'mini-apps'])
    expect(anchors.listChildren?.(`localix://ui/settings/${moved}`)).toEqual([])
})
