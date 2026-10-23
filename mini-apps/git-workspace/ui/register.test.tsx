import { localixResourceUri } from '@localixai/mini-app-sdk/navigation'
import { expect, test } from 'bun:test'
import { recordingMiniAppUiHost } from '@localixai/mini-app-sdk/ui/testing'
import type {
  RailViewletContribution,
  StatusItemContribution,
  UiAnchorContribution,
  WorkItemKindContribution,
} from '@localixai/mini-app-sdk/ui'
import { registerUi } from './register'

test('registers a native auxiliary Git Workspace with a resource anchor', () => {
  // The SDK's recording host, not a literal: this test used to enumerate the registries by hand
  // and cast past the rest, so the day the contract grew a seam the mini app uses, `registerUi`
  // died on `undefined.register` inside a test whose job is to prove registration works.
  const { host, registrations } = recordingMiniAppUiHost()
  const workItems = registrations.workItems as WorkItemKindContribution[]
  const viewlets = registrations.railViewlets as RailViewletContribution[]
  const statusItems = registrations.statusItems as StatusItemContribution[]

  registerUi(host)

  const anchor = (registrations.anchors as UiAnchorContribution[])[0]

  // Namespaced by owner. The host's `assertMiniAppOwnedIdentity` THROWS on a bare `git-workspace`,
  // and because `registerUi` latches `registered` before it registers anything, that first throw
  // silently cost the mini app its entire UI — so the prefix is a contract, not a convention.
  // A SESSION kind: the workspace shows one chat's repository. As a global tab it followed the chat
  // in front, so a switch put another chat's tree under the stage and commit buttons.
  expect(workItems[0]).toMatchObject({
    kind: 'git-workspace:workspace',
    restorable: true,
    scope: 'session',
    placement: 'aux',
  })
  expect(viewlets[0]).toMatchObject({
    kind: 'git-workspace:workspace',
    // Plain `Git` — a display name may not be padded with the container it opens in.
    title: 'Git',
    defaultArea: 'bar',
  })
  // The poller is a session surface, handed its chat by the host — not an app-level `Mount`,
  // which belongs to no chat and could only guess one.
  expect(viewlets[0]?.Mount).toBeUndefined()
  expect(
    (registrations.sessionSurfaces as { surface: string }[]).map(({ surface }) => surface),
  ).toEqual(['chat.background'])
  // The canonical address space, not the retired `git:` scheme.
  expect(anchor?.resolve(localixResourceUri('git', ['project', 'status']))).toEqual({
    kind: 'work-item',
    workKind: 'git-workspace:workspace',
    id: 'git-workspace:workspace',
    title: 'Git',
  })
  expect(anchor?.resolve(localixResourceUri('db', ['primary']))).toBeNull()
  expect(anchor?.resolve('git://project/status')).toBeNull()

  // Both chrome placements are claimed, and both are DECLARED — a hook returning state, never a
  // component. The titlebar button this replaced was hand-drawn and had drifted from the host
  // recipe on height, focus and press feedback.
  expect(statusItems.map(({ id, placement }) => ({ id, placement }))).toEqual([
    { id: 'git-workspace:branch', placement: 'titlebar' },
  ])
})
