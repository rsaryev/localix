import { describe, expect, test } from 'bun:test'
import type { CapabilityRule } from '@/shared/api/contracts'
import { reconcilePermissionRuleKeys } from './permissionRuleRows'

const rule = (tool: string): CapabilityRule => ({
  action: `tool:${tool}`,
  resource: '*',
  effect: 'ask',
})

describe('reconcilePermissionRuleKeys', () => {
  test('preserves identities across edits, removals, and reorder', () => {
    const first = rule('read')
    const second = rule('write')
    const initial = reconcilePermissionRuleKeys([], [first, second], 1)
    expect(initial.entries.map((entry) => entry.key)).toEqual([1, 2])

    const editedFirst = { ...first, resource: '/src/**' }
    const edited = reconcilePermissionRuleKeys(
      initial.entries,
      [editedFirst, second],
      initial.nextKey,
    )
    expect(edited.entries.map((entry) => entry.key)).toEqual([1, 2])

    const reordered = reconcilePermissionRuleKeys(
      edited.entries,
      [second, editedFirst],
      edited.nextKey,
    )
    expect(reordered.entries.map((entry) => entry.key)).toEqual([2, 1])

    const removed = reconcilePermissionRuleKeys(reordered.entries, [editedFirst], reordered.nextKey)
    expect(removed.entries[0]?.key).toBe(1)
  })
})
