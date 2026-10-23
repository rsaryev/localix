/**
 * Every trading action names the chat it acts for.
 *
 * A chart kept open for chat A used to put its book/tape/carry questions and its analysis run into
 * whichever composer had focus, and its opens fell to whichever chat was on screen — chat B's. The
 * chart is now a session tab, so each insert carries the chart's chat and each open carries the
 * chat it lands in; the technicals page reads no session and opens app-level.
 */

import { describe, expect, test } from 'bun:test'
import '@localixai/kit/testing/host-runtime'
import {
  composerBus,
  registerInspectorHandler,
  type ComposerInsert,
  type InspectorRequest,
} from '@localixai/kit/testing'

import { askAgent, buildCarryStatPrefill, runAnalysis } from './askAgent'
import { openTradingChartTab, openTradingTechnicalsTab } from './openTab'

const ref = { connectionId: 'public:hyperliquid', symbol: 'BTC/USDC:USDC' }

function captureInserts(run: () => void): ComposerInsert[] {
  const inserts: ComposerInsert[] = []
  const unsubscribe = composerBus.subscribe((request) => {
    inserts.push(request)
  })
  try {
    run()
  } finally {
    unsubscribe()
  }
  return inserts
}

function captureOpens(run: () => void): InspectorRequest[] {
  const requests: InspectorRequest[] = []
  const unregister = registerInspectorHandler((request) => requests.push(request))
  try {
    run()
  } finally {
    unregister()
  }
  return requests
}

describe('trading actions address their own chat', () => {
  test('a stat question goes to the chart’s chat composer, not the focused one', () => {
    const inserts = captureInserts(() =>
      askAgent('chat-a', buildCarryStatPrefill(ref, { label: 'funding', value: '0.01%' })),
    )
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({ sessionId: 'chat-a' })
  })

  test('the analysis run is submitted in the chart’s chat', () => {
    const inserts = captureInserts(() =>
      runAnalysis('chat-a', ref, {
        style: 'swing',
        strategy: 'auto',
        bias: 'auto',
        risk: 'balanced',
        activeIndicators: [],
      }),
    )
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({ sessionId: 'chat-a', submit: true, internal: true })
  })

  test('a chart opens in the named chat; the technicals page opens app-level', () => {
    const requests = captureOpens(() => {
      openTradingChartTab('chat-a', ref)
      openTradingTechnicalsTab(ref)
    })
    expect(requests).toMatchObject([
      { kind: 'work-item', workKind: 'trading:chart', scope: 'chat-a' },
      { kind: 'work-item', workKind: 'trading:technicals', scope: null },
    ])
  })
})
