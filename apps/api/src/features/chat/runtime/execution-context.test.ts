import { describe, expect, test } from 'bun:test'
import {
  ORCHESTRATION_DELEGATE_TASK,
  executionToolSurface,
  invocationOrigin,
  invocationHost,
  continuationExecutionContext,
  childExecutionContext,
  rootExecutionContext,
  sessionExecutionContext,
} from './execution-context'

describe('run execution context', () => {
  test('continuations cannot restore authority removed from the preceding run', () => {
    const previous = rootExecutionContext()
    previous.authority.capabilities = []
    expect(continuationExecutionContext(previous, 'loop')).toEqual({
      invocation: { kind: 'root', source: 'loop' },
      authority: { capabilities: [] },
    })
  })
  test('invocation policy follows execution provenance, not wake notification source', () => {
    const external = childExecutionContext({ kind: 'channel' })
    expect(invocationHost(external.invocation)).toBe('channel')
    expect(invocationOrigin(external.invocation)).toBe('external')
    expect(executionToolSurface(external).capabilities).toEqual([])
    expect(invocationHost({ kind: 'root', source: 'bg-monitor' })).toBe('chat')
    expect(invocationHost({ kind: 'task-delegation', parentSessionId: 'p' })).toBe('delegation')
    expect(invocationHost({ kind: 'skill-fork', parentSessionId: 'p' })).toBe('delegation')
    expect(invocationHost({ kind: 'loop-subsession', parentSessionId: 'p', loopId: 'l' })).toBe(
      'automation',
    )
    expect(invocationHost({ kind: 'hook', parentSessionId: 'p' })).toBe('verification')
    expect(invocationHost({ kind: 'isolated-continuation', sessionId: 's' })).toBe('unknown')
  })

  test('root authority grants task delegation while preserving ordinary client capabilities', () => {
    const context = rootExecutionContext({ capabilities: ['workbench-ui'] }, 'loop')
    expect(context.invocation).toEqual({ kind: 'root', source: 'loop' })
    expect(executionToolSurface(context).capabilities).toEqual([
      'workbench-ui',
      ORCHESTRATION_DELEGATE_TASK,
    ])
    expect(invocationOrigin(context.invocation)).toBe('loop')
  })

  test('preserves catalog ids only for surviving client capabilities', () => {
    const context = rootExecutionContext({
      capabilities: ['workbench-ui'],
      catalogs: {
        'workbench-ui': 'ui1_catalog',
        [ORCHESTRATION_DELEGATE_TASK]: 'forged',
      },
    })
    expect(executionToolSurface(context)).toEqual({
      capabilities: ['workbench-ui', ORCHESTRATION_DELEGATE_TASK],
      catalogs: { 'workbench-ui': 'ui1_catalog' },
    })
  })

  test('client claims cannot grant protected orchestration authority to an isolated worker', () => {
    const context = childExecutionContext(
      { kind: 'hook', parentSessionId: 'parent', phase: 'verifier' },
      { capabilities: ['workbench-ui', ORCHESTRATION_DELEGATE_TASK] },
    )
    expect(executionToolSurface(context).capabilities).toEqual(['workbench-ui'])
    expect(invocationOrigin(context.invocation)).toBe('hook')
  })

  test('isolated invocation classes cannot delegate another task', () => {
    for (const invocation of [
      { kind: 'task-delegation' as const, parentSessionId: 'parent' },
      { kind: 'loop-subsession' as const, parentSessionId: 'parent', loopId: 'loop' },
      { kind: 'skill-fork' as const, parentSessionId: 'parent' },
    ]) {
      expect(childExecutionContext(invocation).authority.capabilities).not.toContain(
        ORCHESTRATION_DELEGATE_TASK,
      )
    }
  })

  test('reconstructs queued authority from durable provenance', () => {
    const worker = sessionExecutionContext(
      {
        id: 'worker',
        sessionKind: 'job',
        parentSessionId: 'parent',
        rootSessionId: 'parent',
        provenance: { kind: 'loop', parentSessionId: 'parent', loopId: 'loop' },
      },
      { capabilities: [ORCHESTRATION_DELEGATE_TASK] },
      'hook',
    )
    expect(worker.invocation).toEqual({
      kind: 'loop-subsession',
      parentSessionId: 'parent',
      loopId: 'loop',
    })
    expect(executionToolSurface(worker).capabilities).toEqual([])

    const root = sessionExecutionContext(
      {
        id: 'root',
        sessionKind: 'chat',
        parentSessionId: null,
        rootSessionId: 'root',
        provenance: { kind: 'root' },
      },
      undefined,
      'loop',
    )
    expect(root.authority.capabilities).toContain(ORCHESTRATION_DELEGATE_TASK)
  })

  test('persisted root provenance never widens a parented child', () => {
    const child = sessionExecutionContext({
      id: 'child',
      sessionKind: 'chat',
      parentSessionId: 'parent',
      rootSessionId: 'parent',
      provenance: { kind: 'root' },
    })
    expect(child.authority.capabilities).toEqual([])
  })

  test('user-created threads and forks remain interactive orchestrators', () => {
    for (const provenance of [
      { kind: 'thread' as const, parentSessionId: 'parent', phase: 'message' as const },
      { kind: 'fork' as const, parentSessionId: 'parent' },
    ]) {
      const context = sessionExecutionContext({
        id: 'child-chat',
        sessionKind: 'chat',
        parentSessionId: 'parent',
        rootSessionId: 'root',
        provenance,
      })
      expect(context.authority.capabilities).toContain(ORCHESTRATION_DELEGATE_TASK)
    }
  })
})
