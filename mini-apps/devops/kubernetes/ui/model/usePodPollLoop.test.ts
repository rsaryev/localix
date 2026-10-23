import { describe, expect, test } from 'bun:test'
import type { KubePod } from '../../backend/contracts'
import { mergeRefreshOptions } from './useKubernetesInventory'
import { podPollDelay } from './usePodPollLoop'
import { FAST_POLL_MS, SLOW_POLL_MS } from './watchPace'

const settled = { phase: 'Running', readyCount: 1, totalCount: 1, reason: '' } as KubePod
const pending = { phase: 'Pending', readyCount: 0, totalCount: 1, reason: '' } as KubePod

describe('the pod poll cadence', () => {
  test('with the pod and collection watches both live, nothing is re-listed on a timer', () => {
    expect(podPollDelay({ covered: true, podsLive: true, pods: [pending] })).toBeNull()
  })

  test('with only the pod watch live, the other collections keep a slow re-read', () => {
    expect(podPollDelay({ covered: false, podsLive: true, pods: [pending] })).toBe(SLOW_POLL_MS * 4)
  })

  test('with no watch, the poll is the feed: fast while a pod moves, slow once settled', () => {
    expect(podPollDelay({ covered: false, podsLive: false, pods: [pending] })).toBe(FAST_POLL_MS)
    expect(podPollDelay({ covered: false, podsLive: false, pods: [settled] })).toBe(SLOW_POLL_MS)
  })
})

describe('a read asked for while one is in flight', () => {
  test('is kept, reading every collection if either ask wanted them', () => {
    const queued = mergeRefreshOptions(null, { forceSecondary: true, silent: true })
    expect(queued).toEqual({ forceSecondary: true, silent: true })
    expect(mergeRefreshOptions(queued, undefined)).toEqual({ forceSecondary: true, silent: false })
    expect(mergeRefreshOptions({ silent: true }, { silent: true })).toEqual({
      forceSecondary: false,
      silent: true,
    })
  })
})
