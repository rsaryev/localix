import { expect, test } from 'bun:test'
import { recordingMiniAppUiHost } from '@localixai/mini-app-sdk/ui/testing'
import { GRAPH_KIND, GRAPH_URI, graphUri, nodeUri } from '../shared/resource'
import { registerUi } from './register'

test('registers one map per chat, its launcher and its anchor — once per host', () => {
  const { host, registrations } = recordingMiniAppUiHost()
  registerUi(host)
  registerUi(host)
  expect(registrations.workItems).toHaveLength(1)
  expect(registrations.workItems[0]).toMatchObject({
    kind: GRAPH_KIND,
    restorable: true,
    scope: 'session',
  })
  expect(registrations.railViewlets[0]).toMatchObject({ kind: GRAPH_KIND, title: 'Code Graph' })
})

test('a map URI naming its chat opens there; bare and node URIs leave the chat to the host', () => {
  const { host, registrations } = recordingMiniAppUiHost()
  registerUi(host)
  const anchor = registrations.anchors[0] as { resolve: (uri: string) => unknown }
  expect(anchor.resolve(graphUri('s7'))).toMatchObject({
    kind: 'work-item',
    workKind: GRAPH_KIND,
    session: 's7',
  })
  expect(anchor.resolve(GRAPH_URI)).not.toHaveProperty('session')
  expect(anchor.resolve(nodeUri('sym:a.ts#A'))).toMatchObject({ workKind: GRAPH_KIND })
  expect(anchor.resolve('localix://resource/code-graph/other')).toBeNull()
})
