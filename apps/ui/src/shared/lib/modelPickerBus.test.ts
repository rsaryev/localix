import { describe, expect, test } from 'bun:test'
import { openModelPicker, subscribeModelPicker } from './modelPickerBus'

describe('modelPickerBus', () => {
  test('forwards only bounded activation arguments and honors unsubscribe', () => {
    const requests: unknown[] = []
    const unsubscribe = subscribeModelPicker((request) => requests.push(request))

    openModelPicker({ sessionId: 'session-1', query: 'gpt', providerId: 'openai' })
    unsubscribe()
    openModelPicker({ query: 'ignored' })

    expect(requests).toEqual([{ sessionId: 'session-1', query: 'gpt', providerId: 'openai' }])
  })
})
