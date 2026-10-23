import { describe, expect, test } from 'bun:test'
import type { CallClass } from '@localixai/agent/agents'
import { CHART_ACTIONS } from './chart-command'
import { classifyManageChartCall } from './manage-chart-class'

describe('classifyManageChartCall', () => {
  const rows: Array<[string, unknown, CallClass]> = [
    ['snapshot', { action: 'snapshot', symbol: 'BTC/USDT' }, { effect: 'read' }],
    ['detect', { action: 'detect', symbol: 'BTC/USDT' }, { effect: 'read' }],
    ['detect with auto_draw', { action: 'detect', auto_draw: true }, { effect: 'view' }],
    ['open', { action: 'open', symbol: 'BTC/USDT' }, { effect: 'view' }],
    ['set_timeframe', { action: 'set_timeframe', timeframe: '1h' }, { effect: 'view' }],
    ['set_indicators', { action: 'set_indicators' }, { effect: 'view' }],
    ['set_chart_type', { action: 'set_chart_type' }, { effect: 'view' }],
    ['navigate', { action: 'navigate' }, { effect: 'view' }],
    ['draw', { action: 'draw' }, { effect: 'view' }],
    ['configure', { action: 'configure' }, { effect: 'view' }],
    ['unknown action', { action: 'place_order' }, { effect: 'external' }],
    ['no input', undefined, { effect: 'external' }],
  ]
  test.each(rows)('%s', (_label, input, expected) => {
    expect(classifyManageChartCall(input)).toEqual(expected)
  })

  test('every wire action has a row above, so a new one cannot fall to external unseen', () => {
    for (const action of CHART_ACTIONS) {
      expect(classifyManageChartCall({ action }).effect).not.toBe('external')
    }
  })
})
