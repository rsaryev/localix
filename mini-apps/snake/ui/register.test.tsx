import { expect, test } from 'bun:test'
import { sessionResourceAddress } from '@localixai/mini-app-sdk/session-resource'
import { recordingMiniAppUiHost } from '@localixai/mini-app-sdk/ui/testing'

import { GAME_KIND, gameUri } from '../shared/resource'
import { registerUi } from './register'

test('registers one board per chat, its launcher and the anchor its tool opens — once per host', () => {
  const { host, registrations } = recordingMiniAppUiHost()
  registerUi(host)
  registerUi(host)
  expect(registrations.workItems).toHaveLength(1)
  expect(registrations.workItems[0]).toMatchObject({
    kind: GAME_KIND,
    restorable: true,
    scope: 'session',
  })
  expect(registrations.railViewlets[0]).toMatchObject({ kind: GAME_KIND, title: 'Snake' })
})

test('the agent is told it reads the board and never steers', () => {
  const { host, registrations } = recordingMiniAppUiHost()
  registerUi(host)
  expect(JSON.stringify(registrations.workItems[0])).toContain('never steer')
})

test('a board URI that names its chat opens there; the bare one names no chat', () => {
  const { host, registrations } = recordingMiniAppUiHost()
  registerUi(host)
  const anchor = registrations.anchors[0] as { resolve: (uri: string) => unknown }
  expect(anchor.resolve(gameUri('s7'))).toMatchObject({
    kind: 'work-item',
    workKind: GAME_KIND,
    session: 's7',
  })
  expect(anchor.resolve(sessionResourceAddress('snake', 'game').uri)).not.toHaveProperty('session')
  expect(anchor.resolve('localix://resource/snake/other')).toBeNull()
})
