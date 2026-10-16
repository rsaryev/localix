import { describe, expect, test } from 'bun:test'
import {
  isChatBodyPending,
  shouldAnimateEmptyDeparture,
  type ChatEmptyTransitionSnapshot,
} from './chatEmptyTransition'

const state = (
  sessionId: string,
  hasMessages: boolean,
  bodyReady = true,
): ChatEmptyTransitionSnapshot => ({ sessionId, hasMessages, bodyReady })

describe('shouldAnimateEmptyDeparture', () => {
  test('animates the first message inside the same loaded empty chat', () => {
    expect(shouldAnimateEmptyDeparture(state('a', false), state('a', true))).toBe(true)
  })

  test('does not overlay EmptyState when a different session paints from cache', () => {
    expect(shouldAnimateEmptyDeparture(state('a', true), state('b', true))).toBe(false)
  })

  test('does not overlay EmptyState when a routed session body finishes loading', () => {
    expect(shouldAnimateEmptyDeparture(state('b', false, false), state('b', true, true))).toBe(
      false,
    )
  })
})

describe('isChatBodyPending', () => {
  test('keeps a routed session in loading state until its store row arrives', () => {
    expect(isChatBodyPending('session-a', null)).toBe(true)
    expect(isChatBodyPending('session-a', undefined)).toBe(true)
  })

  test('keeps an unloaded roster summary in loading state', () => {
    expect(isChatBodyPending('session-a', { bodyLoaded: false })).toBe(true)
  })

  test('renders a deliberate new-chat draft and loaded bodies without a loading gate', () => {
    expect(isChatBodyPending(null, null)).toBe(false)
    expect(isChatBodyPending('session-a', {})).toBe(false)
    expect(isChatBodyPending('session-a', { bodyLoaded: true })).toBe(false)
  })
})
