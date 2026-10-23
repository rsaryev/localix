import { describe, expect, test } from 'bun:test'
import type { KubePod } from '../../backend/contracts'
import { ALL_CONTAINERS } from './podContainers'
import { logFollowTargetOf, podLogPollMs } from './usePodTabContent'

const followed = (target: ReturnType<typeof logFollowTargetOf>) =>
  target?.provider === 'k8s' ? target.containers : null

const pod = { name: 'web-1', containers: ['app', 'proxy'], initContainers: ['migrate'] } as KubePod
const base = { following: true, context: 'kind', namespace: 'shop', podName: 'web-1', pod }

describe('a pod tab’s live log view', () => {
  test('is not polled while its log is followed, nor for a finished instance', () => {
    expect(podLogPollMs({ followed: true, previous: false })).toBeNull()
    expect(podLogPollMs({ followed: false, previous: true })).toBeNull()
    expect(podLogPollMs({ followed: false, previous: false })).toBe(3000)
  })

  test('follows the selected container, or every app container when interleaved', () => {
    expect(followed(logFollowTargetOf({ ...base, container: 'proxy' }))).toEqual(['proxy'])
    expect(followed(logFollowTargetOf({ ...base, container: '' }))).toEqual(['app'])
    expect(logFollowTargetOf({ ...base, container: ALL_CONTAINERS })).toEqual({
      provider: 'k8s',
      context: 'kind',
      namespace: 'shop',
      pod: 'web-1',
      containers: ['app', 'proxy'],
    })
  })

  test('follows nothing while paused, previous, or before the pod is known', () => {
    expect(logFollowTargetOf({ ...base, following: false, container: 'app' })).toBeNull()
    expect(logFollowTargetOf({ ...base, pod: null, container: 'app' })).toBeNull()
  })
})
