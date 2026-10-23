import { afterEach, expect, test } from 'bun:test'
import type { PluginUiHost, UiAnchorContribution, UiAnchorNode } from '@localixai/mini-app-sdk/ui'
import type { PluginRecord } from '@/shared/api/contracts'
import { __resetPluginContrib, refetchPluginContrib } from '@/shared/contrib/enabledPlugins'
import { registerUi } from './contrib'

afterEach(__resetPluginContrib)

test('exposes exact-scope plugin rows to the centralized /open anchor tree', async () => {
  const plugin = {
    name: 'sample-plugin',
    displayName: 'Sample Workspace',
    projectId: 'PRJ-1',
    enabled: true,
  } as PluginRecord
  await refetchPluginContrib(
    {
      // ONE loader, not the former panels/plugins/views fan-out: the store now reads a
      // single server-computed snapshot, which is what makes it impossible for the
      // plugin list and the tool list to disagree about which plugins are on.
      loadSnapshot: async () => ({
        revision: 1,
        scope: { projectId: 'PRJ-1', agentId: null, sessionId: null },
        plugins: [plugin],
        tools: {
          enabled: [],
          disabled: [],
          catalog: [],
          categoryLabels: {},
          mcp: [],
          mcpUnprobedServers: [],
        },
        views: [],
        panels: [],
        agents: [],
        commands: [],
        mcp: [],
        skills: [],
        tips: [],
        grammar: { kinds: [], effects: [], classes: [], examples: [] },
        themes: [],
      }),
    },
    async () => {},
  )

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
  } as unknown as PluginUiHost)

  const rows = contribution?.listChildren?.('localix://ui/settings/plugins') as UiAnchorNode[]
  expect(rows.find((row) => row.label === 'Sample Workspace')).toMatchObject({
    uri: 'localix://ui/settings/plugins/plugin-sample-plugin?scope=PRJ-1',
    hasChildren: false,
    icon: 'plugin',
  })
})
