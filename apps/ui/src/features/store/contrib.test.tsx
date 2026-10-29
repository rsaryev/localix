import { expect, test } from 'bun:test'

import type { MiniAppUiHost, WorkItemKindContribution } from '@localixai/mini-app-sdk/ui'
import { registerUi, storeTarget } from './contrib'

test('the Store is one app-level tab that comes back after a restart', () => {
  const workItems: WorkItemKindContribution[] = []
  const noop = { register: () => {} }
  const host = new Proxy(
    { workItems: { register: (item: WorkItemKindContribution) => workItems.push(item) } },
    { get: (target, key) => (target as Record<string | symbol, unknown>)[key] ?? noop },
  ) as unknown as MiniAppUiHost

  registerUi(host)

  expect(workItems).toEqual([
    expect.objectContaining({ kind: 'store', scope: 'global', restorable: true }),
  ])
})

test('the tab’s payload is where it opens; anything else in it is ignored', () => {
  expect(storeTarget({ shelf: 'package:mini-app' })).toEqual({ shelf: 'package:mini-app' })
  expect(storeTarget({ ref: { kind: 'mini-app', id: 'puzzle' }, other: 1 })).toEqual({
    ref: { kind: 'mini-app', id: 'puzzle' },
  })
  expect(
    storeTarget({ addSource: { kind: 'mini-app', input: 'https://ada.test/c.json' } }),
  ).toEqual({ addSource: { kind: 'mini-app', input: 'https://ada.test/c.json' } })
  expect(storeTarget({ shelf: 3, ref: 'puzzle' })).toEqual({})
  expect(storeTarget(undefined)).toEqual({})
})
