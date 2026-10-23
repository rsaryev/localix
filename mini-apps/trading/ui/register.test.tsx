import { expect, test } from 'bun:test'

import { recordingMiniAppUiHost } from '@localixai/mini-app-sdk/ui/testing'
import type {
  RailSectionContribution,
  RailViewletContribution,
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
test('registers one Trading Workspace viewlet over chart and technical work items', () => {
  const { host, registrations } = recordingMiniAppUiHost()

  registerUi(host)

  const workItems = registrations.workItems as WorkItemKindContribution[]
  const railSections = registrations.railSections as RailSectionContribution[]
  const railViewlets = registrations.railViewlets as RailViewletContribution[]
  const anchor = (registrations.anchors as UiAnchorContribution[])[0]

  expect(railSections).toEqual([])
  expect(railViewlets.map((viewlet) => viewlet.kind)).toEqual(['trading:workspace'])
  expect(railViewlets[0]?.title).toBe('Trading')
  expect(railViewlets[0]?.defaultArea).toBe('overflow')
  expect(workItems.map((item) => item.kind).sort()).toEqual([
    'trading:chart',
    'trading:technicals',
    'trading:workspace',
  ])
  // The workspace and a chart act for a chat (they open charts, ask its agent) — session tabs. The
  // technicals page reads public data only and stays app-level.
  const scopes = Object.fromEntries(workItems.map((item) => [item.kind, item.scope ?? 'session']))
  expect(scopes).toEqual({
    'trading:workspace': 'session',
    'trading:chart': 'session',
    'trading:technicals': 'global',
  })
  expect(workItems.find((item) => item.kind === 'trading:workspace')?.restorable).toBe(true)
  expect(
    workItems
      .find((item) => item.kind === 'trading:chart')
      ?.toMessageBinding?.(
        {
          kind: 'trading:chart',
          id: 'trading:chart:public:hyperliquid:BTC',
          title: 'BTC/USDC:USDC',
          payload: {
            connectionId: 'public:hyperliquid',
            symbol: 'BTC/USDC:USDC',
          },
        },
        { session: null },
      ),
  ).toMatchObject({
    target: {
      kind: 'resource',
      token: '@resource:localix://resource/trade/public%3Ahyperliquid/markets/BTC%2FUSDC%3AUSDC',
      uri: 'localix://resource/trade/public%3Ahyperliquid/markets/BTC%2FUSDC%3AUSDC',
    },
  })

  expect(anchor?.resolve('localix://resource/trade/public%3Ahyperliquid')).toEqual({
    kind: 'work-item',
    workKind: 'trading:workspace',
    id: 'trading:workspace',
    title: 'Trading',
    payload: { area: 'markets' },
  })
  expect(
    anchor?.resolve('localix://resource/trade/public%3Ahyperliquid/markets/BTC%2FUSDC%3AUSDC'),
  ).toMatchObject({
    kind: 'work-item',
    workKind: 'trading:chart',
    title: 'BTC/USDC:USDC',
  })

  // Asserted here rather than in a second test: `registerUi` is once-only, so a second call
  // records nothing and a second case would prove only that.
  const items = registrations.statusItems as StatusItemContribution[]
  expect(items.map(({ id, placement }) => ({ id, placement }))).toEqual([
    { id: 'trading:market', placement: 'titlebar' },
  ])
})
