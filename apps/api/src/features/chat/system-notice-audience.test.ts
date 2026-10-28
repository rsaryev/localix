import { describe, expect, test } from 'bun:test'

import { noticeVisibility } from './system-notice-audience'

describe('the persisted visibility of a system notice', () => {
  test('every notice stays out of history because its binding owns model visibility', () => {
    for (const kind of [
      'model_change',
      'reasoning_change',
      'connection_change',
      'run_failed',
      'run_interrupted',
      'turn_limit',
    ] as const) {
      expect(noticeVisibility({ kind, tone: 'neutral', text: 'x' })).toEqual({ uiOnly: true })
    }
  })

  test('a marker carrying no notice is presentation-only too', () => {
    expect(noticeVisibility(undefined)).toEqual({ uiOnly: true })
  })
})
