import { expect, test } from 'bun:test'

import type {
  PluginUiHost,
  RailViewletContribution,
  UiAnchorContribution,
  WorkItemKindContribution,
} from '@localixai/mini-app-sdk/ui'
import { registerUi } from './contrib'

test('registers the core Vault as a global restorable workspace and URI anchor', () => {
  const workItems: WorkItemKindContribution[] = []
  const railViewlets: RailViewletContribution[] = []
  const anchors: UiAnchorContribution[] = []
  const noop = { register: () => {} }
  const host = {
    workItems: { register: (item: WorkItemKindContribution) => workItems.push(item) },
    railSections: noop,
    railViewlets: {
      register: (viewlet: RailViewletContribution) => railViewlets.push(viewlet),
    },
    search: noop,
    anchors: {
      register: (anchor: UiAnchorContribution) => {
        anchors.push(anchor)
        return true
      },
    },
    resourceRefIcons: noop,
    fileEditors: noop,
    fileFormats: noop,
    sessionEvents: noop,
  } as unknown as PluginUiHost

  registerUi(host)

  expect(workItems[0]).toMatchObject({
    kind: 'secrets-manager',
    scope: 'global',
    restorable: true,
  })
  expect(railViewlets[0]).toMatchObject({
    kind: 'secrets-manager',
    title: 'Vault',
    defaultArea: 'bar',
    toolCategory: 'utilities',
  })
  expect(railViewlets[0]?.pluginName).toBeUndefined()
  expect(anchors[0]?.resolve('localix://resource/vault/items/OPENAI_KEY')).toMatchObject({
    kind: 'work-item',
    workKind: 'secrets-manager',
    payload: { selectedKey: 'OPENAI_KEY' },
  })
})
