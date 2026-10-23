import { expect, test } from 'bun:test'
import { sessionResourceAddress } from '@localixai/plugin-sdk/session-resource'
import { recordingPluginUiHost } from '@localixai/plugin-sdk/ui/testing'

import { GAME_KIND, gameUri } from '../shared/resource'
import { registerUi } from './register'

test('registers one board per chat, its launcher and the anchor its tool opens — once per host', () => {
  const { host, registrations } = recordingPluginUiHost()
  registerUi(host)
  registerUi(host)

  expect(registrations.workItems).toHaveLength(1)
  expect(registrations.workItems[0]).toMatchObject({
    kind: GAME_KIND,
    restorable: true,
    scope: 'session',
  })
  expect(registrations.railViewlets[0]).toMatchObject({ kind: GAME_KIND, title: 'Battleship' })
})

test('a board URI that names its chat opens there; the bare one names no chat', () => {
  const { host, registrations } = recordingPluginUiHost()
  registerUi(host)
  const anchor = registrations.anchors[0] as { resolve: (uri: string) => unknown }

  expect(anchor.resolve(gameUri('s7'))).toMatchObject({ workKind: GAME_KIND, session: 's7' })
  expect(anchor.resolve(sessionResourceAddress('battleship', 'game').uri)).not.toHaveProperty(
    'session',
  )
  expect(anchor.resolve('localix://resource/battleship/other')).toBeNull()
})
