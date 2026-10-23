import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

import { sessionResourceAddress } from '../session-resource'
import type { PublishMessageContext } from './message-bindings'
import { sessionGameUi } from './session-game'
import { recordingMiniAppUiHost } from './testing'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const address = sessionResourceAddress('toy', 'game')
const Icon = () => null
const seen: { active: boolean; publishMessageContext: PublishMessageContext }[] = []
function Workspace(props: { active: boolean; publishMessageContext: PublishMessageContext }) {
  seen.push(props)
  return <p>the board</p>
}
const registerUi = sessionGameUi({
  plugin: 'toy',
  kind: 'toy:game',
  title: 'Toy',
  label: 'Toy — play against the agent',
  keywords: ['game', 'toy'],
  Icon,
  Workspace,
  loading: <p>Opening Toy…</p>,
  agentContext: { description: 'This chat’s toy board.', tools: ['toy'] },
  sessionOf: address.sessionOf,
})

test('registers one board per chat, its launcher and the anchor its tool opens — once per host', () => {
  const { host, registrations } = recordingMiniAppUiHost()
  registerUi(host)
  registerUi(host)

  expect(registrations.workItems).toEqual([
    {
      kind: 'toy:game',
      Component: expect.any(Function),
      Icon,
      restorable: true,
      scope: 'session',
      agentContext: { description: 'This chat’s toy board.', tools: ['toy'] },
    },
  ])
  expect(registrations.railViewlets).toEqual([
    {
      kind: 'toy:game',
      title: 'Toy',
      label: 'Toy — play against the agent',
      defaultArea: 'overflow',
      keywords: ['game', 'toy'],
      Icon,
    },
  ])
  expect(registrations.anchors).toEqual([
    {
      id: 'toy:game-anchor',
      namespaces: ['toy'],
      icons: { game: Icon },
      resolve: expect.any(Function),
    },
  ])
  // Another host is another registration.
  const other = recordingMiniAppUiHost()
  registerUi(other.host)
  expect(other.registrations.workItems).toHaveLength(1)
})

test('a board URI that names its chat opens there; the bare one names no chat', () => {
  const { host, registrations } = recordingMiniAppUiHost()
  registerUi(host)
  const anchor = registrations.anchors[0] as { resolve: (uri: string) => unknown }

  expect(anchor.resolve(address.forSession('s7'))).toEqual({
    kind: 'work-item',
    workKind: 'toy:game',
    id: 'toy:game',
    title: 'Toy',
    session: 's7',
  })
  expect(anchor.resolve(address.uri)).toEqual({
    kind: 'work-item',
    workKind: 'toy:game',
    id: 'toy:game',
    title: 'Toy',
  })
  expect(anchor.resolve('localix://resource/toy/other')).toBeNull()
})

test('the work item shows the board, active while the tab is visible', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { host, registrations } = recordingMiniAppUiHost()
  registerUi(host)
  const { Component } = registrations.workItems[0] as {
    Component: (props: { visible: boolean; publishMessageContext: PublishMessageContext }) => null
  }
  const publish: PublishMessageContext = () => {}
  const element = document.createElement('div')
  const root = createRoot(element)
  try {
    await act(async () =>
      root.render(<Component visible={false} publishMessageContext={publish} />),
    )
    expect(element.textContent).toBe('the board')
    expect(seen.at(-1)).toEqual({ active: false, publishMessageContext: publish })
  } finally {
    await act(async () => root.unmount())
  }
})
