import { describe, expect, test } from 'bun:test'

import type { KubePod } from '../../backend/contracts'
import { podHealth } from './groupPods'
import { podReasonKind } from './podReason'
import { podInFlux } from './watchPace'

const pod = (over: Partial<KubePod>): KubePod =>
  ({ phase: 'Running', reason: '', readyCount: 1, totalCount: 1, ...over }) as KubePod

describe('podReasonKind — one vocabulary for grouping and pacing', () => {
  test('classifies the common kubelet reasons', () => {
    expect(podReasonKind('CrashLoopBackOff')).toBe('backoff')
    expect(podReasonKind('ErrImagePull')).toBe('backoff')
    expect(podReasonKind('OOMKilled')).toBe('failed')
    expect(podReasonKind('CreateContainerConfigError')).toBe('failed')
    expect(podReasonKind('Init:Error')).toBe('failed')
    expect(podReasonKind('Init:0/2')).toBe('transitional')
    expect(podReasonKind('Terminating')).toBe('transitional')
    expect(podReasonKind('Completed')).toBeNull()
    expect(podReasonKind('')).toBeNull()
  })

  test('a backoff pod is both unhealthy and polled fast', () => {
    const crashing = pod({ reason: 'CrashLoopBackOff', readyCount: 0 })
    expect(podHealth(crashing)).toBe('failed')
    expect(podInFlux(crashing)).toBe(true)
  })

  test('a settled failure is unhealthy but does not keep the poll fast', () => {
    const oom = pod({ reason: 'OOMKilled' })
    expect(podHealth(oom)).toBe('failed')
    expect(podInFlux(oom)).toBe(false)
  })

  test('a terminating pod is in flux without being called a failure', () => {
    const leaving = pod({ reason: 'Terminating' })
    expect(podInFlux(leaving)).toBe(true)
    expect(podHealth(leaving)).toBe('healthy')
  })
})
