import { expect, test } from 'bun:test'

import { recordingMiniAppUiHost } from '@localixai/mini-app-sdk/ui/testing'
import type {
  RailViewletContribution,
  StatusItemContribution,
  WorkItemKindContribution,
} from '@localixai/mini-app-sdk/ui'
import { registerUi } from './register'

/**
 * Registration goes through the SDK's recording host, not a hand-built literal.
 *
 * The literal this replaced named every seam the mini app used and cast past the rest, so the day
 * the contract grew one more, `registerUi` died on `undefined.register` — inside the test whose
 * job is to prove registration works. The completeness check belongs in the package that owns the
 * contract, and does.
 */
test('registers one DevOps Workspace viewlet over both provider contribution sets', () => {
  const { host, registrations } = recordingMiniAppUiHost()

  registerUi(host)

  const workItems = registrations.workItems as WorkItemKindContribution[]
  const railViewlets = registrations.railViewlets as RailViewletContribution[]

  expect(railViewlets.map((viewlet) => viewlet.kind)).toEqual(['devops:workspace'])
  expect(railViewlets[0]?.title).toBe('DevOps')
  expect(railViewlets[0]?.defaultArea).toBe('overflow')
  expect(railViewlets[0]?.Mount).toBeDefined()
  expect(workItems.map((item) => item.kind).sort()).toEqual([
    'devops:docker-container',
    'devops:docker-resource',
    'devops:kubernetes-pod',
    'devops:kubernetes-resource',
    'devops:workspace',
  ])
  // Only the Docker resource tab acts for no chat. The rest open shells in, or tabs into, the chat
  // they belong to, so they are session kinds.
  expect(workItems.filter((item) => item.scope === 'global').map((item) => item.kind)).toEqual([
    'devops:docker-resource',
  ])
  expect(workItems.find((item) => item.kind === 'devops:workspace')?.restorable).toBe(true)
  expect(
    workItems
      .filter((item) => item.kind !== 'devops:workspace')
      .every((item) => item.restorable === false),
  ).toBe(true)

  // Asserted here rather than in a second test: `registerUi` is once-only, so a second call
  // records nothing and a second case would prove only that.
  const items = registrations.statusItems as StatusItemContribution[]
  expect(items.map(({ id, placement }) => ({ id, placement }))).toEqual([
    { id: 'devops:port-forwards', placement: 'titlebar' },
  ])
})
