import { expect, test } from 'bun:test'
import { recordingMiniAppUiHost } from '@localixai/mini-app-sdk/ui/testing'
import { registerUi } from './register'

test('registers one restorable screen and its overflow launcher per host', () => {
  const { host, registrations } = recordingMiniAppUiHost()
  registerUi(host)
  registerUi(host)
  expect(registrations.workItems).toHaveLength(1)
  expect(registrations.workItems[0]).toMatchObject({
    kind: 'template:screen',
    restorable: true,
    scope: 'global',
  })
  expect(registrations.railViewlets).toHaveLength(1)
  expect(registrations.railViewlets[0]).toMatchObject({
    kind: 'template:screen',
    title: 'Daily Log',
    defaultArea: 'overflow',
  })
  const second = recordingMiniAppUiHost()
  registerUi(second.host)
  expect(second.registrations.workItems).toHaveLength(1)
})
