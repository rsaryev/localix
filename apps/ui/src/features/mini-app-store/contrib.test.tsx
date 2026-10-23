import { expect, test } from 'bun:test'

import type { MiniAppUiHost, WorkItemKindContribution } from '@localixai/mini-app-sdk/ui'
import { registerUi } from './contrib'

test('the mini app store is an app-level tab that comes back after a restart', () => {
  const workItems: WorkItemKindContribution[] = []
  const noop = { register: () => {} }
  const host = new Proxy(
    { workItems: { register: (item: WorkItemKindContribution) => workItems.push(item) } },
    { get: (target, key) => (target as Record<string | symbol, unknown>)[key] ?? noop },
  ) as unknown as MiniAppUiHost

  registerUi(host)

  expect(workItems).toEqual([
    expect.objectContaining({ kind: 'mini-app-store', scope: 'global', restorable: true }),
  ])
})
