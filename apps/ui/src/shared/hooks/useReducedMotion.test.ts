import { describe, expect, test } from 'bun:test'
import { motionSafeScrollBehavior, REDUCED_MOTION_QUERY } from '@localixai/kit/environment'

describe('reduced-motion runtime helpers', () => {
  test('uses the canonical OS query', () => {
    expect(REDUCED_MOTION_QUERY).toBe('(prefers-reduced-motion: reduce)')
  })

  test('downgrades only explicit smooth scrolling when motion is reduced', () => {
    expect(motionSafeScrollBehavior('smooth', true)).toBe('auto')
    expect(motionSafeScrollBehavior('auto', true)).toBe('auto')
    expect(motionSafeScrollBehavior('smooth', false)).toBe('smooth')
  })
})
