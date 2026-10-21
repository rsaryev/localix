import { describe, expect, test } from 'bun:test'
import type { MessageContextBinding } from '@/shared/api/contracts'
import { anyContextNeedsAttention, contextStatus } from './contextStatus'

const STATUSES: MessageContextBinding['resolution']['status'][] = [
  'pending',
  'resolved',
  'empty',
  'unsupported',
  'out_of_scope',
  'denied',
  'timeout',
  'deadline_exceeded',
  'aborted',
  'error',
]

describe('contextStatus', () => {
  test('every runtime status reads as a word, never as its identifier', () => {
    for (const status of STATUSES) {
      const { label } = contextStatus(status)
      expect(label).not.toContain('_')
      expect(label).not.toBe(status)
    }
  })

  test('only a context the model did not get asks for attention', () => {
    expect(contextStatus('resolved').tone).toBe('quiet')
    // The regression the old pill state guarded: pending flashed as a failure on every send.
    expect(contextStatus('pending').tone).toBe('pending')
    for (const status of STATUSES.filter((s) => s !== 'resolved' && s !== 'pending')) {
      expect(contextStatus(status).tone).toBe('attention')
    }
    const binding = (status: MessageContextBinding['resolution']['status']) =>
      ({ resolution: { status } }) as MessageContextBinding
    expect(anyContextNeedsAttention([binding('resolved'), binding('pending')])).toBe(false)
    expect(anyContextNeedsAttention([binding('resolved'), binding('denied')])).toBe(true)
  })
})
