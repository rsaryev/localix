import { describe, expect, test } from 'bun:test'
import {
  BUILTIN_LIFECYCLE_EVENTS,
  createLifecycleEventRegistry,
  resolveLifecycleGate,
} from './lifecycle'

describe('native lifecycle control points', () => {
  test('each rejection has the effect belonging to its native control point', () => {
    for (const [gate, kind] of [
      ['observe', 'none'],
      ['tool', 'deny-tool'],
      ['input', 'reject-input'],
      ['completion', 'continue-run'],
    ] as const) {
      expect(
        resolveLifecycleGate({ id: 'custom.check', gate }, { accepted: false, reason: 'review' }),
      ).toEqual(kind === 'none' ? { kind } : { kind, reason: 'review' })
    }
  })

  test('accepting any lifecycle check does not grant tool permissions', () => {
    for (const event of BUILTIN_LIFECYCLE_EVENTS) {
      expect(resolveLifecycleGate(event, { accepted: true })).toEqual({ kind: 'none' })
    }
  })

  test('a host can register and remove a new control point without changing builtin events', () => {
    const registry = createLifecycleEventRegistry()
    const initial = registry.list()
    const remove = registry.register({ id: 'scheduler.before-launch', gate: 'input' })
    expect(registry.get('scheduler.before-launch')?.gate).toBe('input')
    remove()
    expect(registry.list()).toEqual(initial)
    expect(registry.get('unknown')).toBeUndefined()
    expect(registry.get('SessionStart')).toBeUndefined()
  })

  test('registrations cannot override builtins or unload a replacement', () => {
    const registry = createLifecycleEventRegistry()
    expect(() => registry.register({ id: 'tool.before', gate: 'observe' })).toThrow(
      'already registered',
    )
    const first = registry.register({ id: 'custom.check', gate: 'input' })
    first()
    registry.register({ id: 'custom.check', gate: 'tool' })
    first()
    expect(registry.get('custom.check')?.gate).toBe('tool')
  })

  test('invalid definitions are refused and caller mutations cannot change registered semantics', () => {
    const registry = createLifecycleEventRegistry()
    expect(() =>
      registry.register(JSON.parse('{"id":"invalid","gate":"allow-everything"}')),
    ).toThrow()
    const descriptor = { id: 'custom.check', gate: 'input' as const }
    registry.register(descriptor)
    descriptor.id = 'changed'
    expect(registry.get('custom.check')).toEqual({ id: 'custom.check', gate: 'input' })
    expect(Object.isFrozen(registry.get('custom.check'))).toBe(true)
  })
})
