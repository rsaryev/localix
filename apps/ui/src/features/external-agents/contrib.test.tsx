import { expect, test } from 'bun:test'
import type { PluginUiHost, WorkItemKindContribution, UiAnchorContribution } from '@localixai/plugin-sdk/ui'
import { registerUi } from './contrib'
import { externalSessionUri } from './model/sessionResource'

test('core external transcripts and resource anchors work without a plugin or extra rail entry', () => {
  const workItems: WorkItemKindContribution[] = []
  const anchors: UiAnchorContribution[] = []
  const rail: unknown[] = []
  const host = {
    workItems: { register: (item: WorkItemKindContribution) => workItems.push(item) },
    anchors: { register: (anchor: UiAnchorContribution) => anchors.push(anchor) },
    railSections: { register: (item: unknown) => rail.push(item) },
    railViewlets: { register: (item: unknown) => rail.push(item) },
  } as unknown as PluginUiHost
  registerUi(host)
  const kind = workItems.find((item) => item.kind === 'external-agent-transcript')!
  const uri = externalSessionUri('codex:s1')
  expect(kind.scope).toBe('global')
  expect(kind.pluginName).toBeUndefined()
  expect(kind.agentContext).toMatchObject({ tools: ['external_agent_sessions'] })
  expect(anchors[0]?.resolve(uri)).toMatchObject({ kind: 'work-item', workKind: kind.kind, payload: { key: 'codex:s1', uri } })
  expect(anchors[0]?.resolve('localix://resource/external-agent/codex/cwd/%2Fwork%2Fproject')).toMatchObject({ kind: 'work-item', workKind: 'external-agent-history', payload: { provider: 'codex', cwd: '/work/project' } })
  expect(rail).toEqual([])
})
