import { describe, expect, test } from 'bun:test'
import {
  conflictResolutionMatches,
  shouldAdoptConflictResolution,
  type ConflictResolution,
} from './conflictResolvedBus'

const resolution: ConflictResolution = {
  sessionId: 'session-a',
  editPath: '/workspace/shared.ts',
  expectedBuffer: 'compared edits',
  content: 'resolved',
  hash: 'hash-a',
}

describe('conflict resolution ownership', () => {
  test('matches both session and absolute path', () => {
    expect(conflictResolutionMatches('session-a', '/workspace/shared.ts', resolution)).toBe(true)
    expect(conflictResolutionMatches('session-b', '/workspace/shared.ts', resolution)).toBe(false)
    expect(conflictResolutionMatches('session-a', '/workspace/other.ts', resolution)).toBe(false)
  })

  test('adopts only when the editor still holds the compared snapshot', () => {
    expect(shouldAdoptConflictResolution('compared edits', resolution)).toBe(true)
    expect(shouldAdoptConflictResolution('newer edits', resolution)).toBe(false)
  })
})
