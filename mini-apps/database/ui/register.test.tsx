import { expect, test } from 'bun:test'

import { recordingMiniAppUiHost } from '@localixai/mini-app-sdk/ui/testing'
import type {
  RailSectionContribution,
  RailViewletContribution,
  SearchDomainContribution,
  StatusItemContribution,
  UiAnchorContribution,
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
test('registers Database as a root workspace and routes resource anchors into Explorer', () => {
  const { host, registrations } = recordingMiniAppUiHost()

  registerUi(host)

  const workItems = registrations.workItems as WorkItemKindContribution[]
  const railSections = registrations.railSections as RailSectionContribution[]
  const railViewlets = registrations.railViewlets as RailViewletContribution[]
  const searchDomains = registrations.search as SearchDomainContribution[]
  const anchor = (registrations.anchors as UiAnchorContribution[])[0]

  expect(railSections).toEqual([])
  expect(railViewlets.map((viewlet) => viewlet.kind)).toEqual(['database:workspace'])
  expect(railViewlets[0]?.title).toBe('Database')
  expect(railViewlets[0]?.defaultArea).toBe('overflow')
  expect(railViewlets[0]?.Mount).toBeDefined()
  expect(searchDomains).toMatchObject([
    {
      id: 'database:search',
      scope: { prefix: 'db', aliases: ['sql'], icon: 'database' },
    },
  ])
  expect(searchDomains[0]?.icons?.database).toBeDefined()
  expect(workItems.map((item) => item.kind).sort()).toEqual([
    'database:connection',
    'database:console',
    'database:diagram',
    'database:table',
    'database:workspace',
  ])
  // Every kind belongs to a chat: a console predicts edits for its chat, and the others open
  // consoles and tables into theirs. A 'global' kind would have to guess which chat that is.
  expect(workItems.every((item) => item.scope !== 'global')).toBe(true)
  expect(workItems.every((item) => item.restorable === true)).toBe(true)
  expect(
    workItems
      .find((item) => item.kind === 'database:console')
      ?.toMessageBinding?.(
        {
          kind: 'database:console',
          id: 'db-console:primary',
          title: 'Primary database',
          payload: { connectionId: 'primary' },
        },
        { session: null },
      ),
  ).toMatchObject({
    target: {
      kind: 'resource',
      token: '@resource:localix://resource/db/primary',
      uri: 'localix://resource/db/primary',
    },
  })

  // Connection, table and diagram tabs link the db resource they carry, and nothing else.
  for (const kind of ['database:connection', 'database:table', 'database:diagram']) {
    const contribution = workItems.find((item) => item.kind === kind)
    const tab = (resourceUri: string) => ({
      kind,
      id: `${kind}:x`,
      title: 'users',
      payload: { resourceUri, color: 'blue' },
    })
    expect(
      contribution?.toMessageBinding?.(tab('localix://resource/db/primary/_/public/users'), {
        session: null,
      }),
    ).toMatchObject({
      target: { kind: 'resource', uri: 'localix://resource/db/primary/_/public/users' },
    })
    expect(
      contribution?.toMessageBinding?.(tab('localix://resource/trade/primary'), { session: null }),
    ).toBeNull()
    expect(contribution?.iconTint?.(tab('localix://resource/db/primary'))).toBe(
      workItems
        .find((item) => item.kind === 'database:console')
        ?.iconTint?.(tab('localix://resource/db/primary')),
    )
  }

  expect(anchor?.resolve('localix://resource/db/primary/_/public/users')).toEqual({
    kind: 'work-item',
    workKind: 'database:workspace',
    id: 'database:workspace',
    title: 'Database',
    payload: { area: 'explorer', resourceUri: 'localix://resource/db/primary/_/public/users' },
  })
  expect(anchor?.resolve('localix://resource/trade/primary')).toBeNull()

  // Asserted here rather than in a second test: `registerUi` is once-only, so a second call
  // records nothing and a second case would prove only that.
  const items = registrations.statusItems as StatusItemContribution[]
  expect(items.map(({ id, placement }) => ({ id, placement }))).toEqual([
    { id: 'database:connection', placement: 'titlebar' },
  ])
})
