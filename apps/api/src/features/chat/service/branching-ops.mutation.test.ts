import { describe, expect, test } from 'bun:test'

import { createKeyedSerializer } from '../../../lib/keyed-serializer'
import type { SessionRecord } from '../repository'
import type { SessionDetail } from '../contracts'
import { checkoutBranch, rollback, switchBranch, type BranchingOpsContext } from './branching-ops'

const chatSession = {
  id: 'session-1',
  userId: 'user-1',
  sessionKind: 'chat',
} as SessionRecord

const detail = { id: chatSession.id } as unknown as SessionDetail

const context = (input: {
  repo: Record<string, unknown>
  isBusy?: () => boolean
  requireSession?: () => Promise<SessionRecord>
}): BranchingOpsContext =>
  ({
    repo: input.repo,
    runner: {
      isRunning: () => false,
      isBusy: input.isBusy ?? (() => false),
    },
    streamRegistry: { publish: () => {} },
    now: () => '2026-07-22T00:00:00.000Z',
    requireSession: input.requireSession ?? (async () => chatSession),
    getSessionDetail: async () => detail,
    withSessionMutationLock: createKeyedSerializer(),
  }) as unknown as BranchingOpsContext

describe('branch mutation concurrency', () => {
  test('rollback, switch, and checkout all reject the runner drain window before touching the tree', async () => {
    let repoTouches = 0
    const touch = async () => {
      repoTouches += 1
      return []
    }
    const ctx = context({
      // isRunning=false + isBusy=true is the wake drain window. Every mutating
      // branch route must use the stronger predicate shared with turn entry.
      isBusy: () => true,
      repo: {
        listMessages: touch,
        siblings: touch,
        getMessage: touch,
      },
    })

    for (const operation of [
      () => rollback(ctx, 'user-1', 'session-1', 'user-message'),
      () => switchBranch(ctx, 'user-1', 'session-1', 'assistant-message', 0),
      () => checkoutBranch(ctx, 'user-1', 'session-1', 'assistant-message'),
    ]) {
      const error = await operation().then(
        () => null,
        (reason: unknown) => reason,
      )
      expect(error).toMatchObject({ status: 409, code: 'session_busy' })
    }
    expect(repoTouches).toBe(0)
  })

  test('serializes concurrent switch and checkout without entering the second repository mutation early', async () => {
    const calls: string[] = []
    let releaseFirst!: () => void
    let firstEntered!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const entered = new Promise<void>((resolve) => {
      firstEntered = resolve
    })
    let requireCount = 0
    const ctx = context({
      requireSession: async () => {
        requireCount += 1
        calls.push(`require:${requireCount}`)
        return chatSession
      },
      repo: {
        siblings: async () => {
          calls.push('switch:entered')
          firstEntered()
          await firstGate
          calls.push('switch:released')
          return ['branch-a']
        },
        descendToLeaf: async (_sessionId: string, messageId: string) => {
          calls.push(`descend:${messageId}`)
          return `${messageId}-leaf`
        },
        setSessionLeaf: async (_sessionId: string, messageId: string) => {
          calls.push(`leaf:${messageId}`)
        },
        getMessage: async () => {
          calls.push('checkout:get-message')
          return { id: 'branch-b' }
        },
      },
    })
    ctx.getSessionDetail = async () => {
      calls.push('detail')
      return detail
    }

    const first = switchBranch(ctx, 'user-1', 'session-1', 'branch-current', 0)
    await entered
    const second = checkoutBranch(ctx, 'user-1', 'session-1', 'branch-b')

    // The checkout is issued concurrently, but the shared keyed serializer keeps
    // even its require/busy/read phase behind the in-flight switch mutation.
    await Promise.resolve()
    await Promise.resolve()
    expect(calls).toEqual(['require:1', 'switch:entered'])

    releaseFirst()
    await Promise.all([first, second])
    expect(calls).toEqual([
      'require:1',
      'switch:entered',
      'switch:released',
      'descend:branch-a',
      'leaf:branch-a-leaf',
      'detail',
      'require:2',
      'checkout:get-message',
      'descend:branch-b',
      'leaf:branch-b-leaf',
      'detail',
    ])
  })

  test('a queued mutation re-checks busy after acquiring the lock', async () => {
    let busy = false
    let releaseFirst!: () => void
    let firstEntered!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const entered = new Promise<void>((resolve) => {
      firstEntered = resolve
    })
    let checkoutReads = 0
    const ctx = context({
      isBusy: () => busy,
      repo: {
        siblings: async () => {
          firstEntered()
          await firstGate
          return ['branch-a']
        },
        descendToLeaf: async (_sessionId: string, messageId: string) => messageId,
        setSessionLeaf: async () => {},
        getMessage: async () => {
          checkoutReads += 1
          return { id: 'branch-b' }
        },
      },
    })

    const first = switchBranch(ctx, 'user-1', 'session-1', 'branch-current', 0)
    await entered
    const queued = checkoutBranch(ctx, 'user-1', 'session-1', 'branch-b')
    busy = true
    releaseFirst()

    await first
    const error = await queued.then(
      () => null,
      (reason: unknown) => reason,
    )
    expect(error).toMatchObject({ status: 409, code: 'session_busy' })
    expect(checkoutReads).toBe(0)
  })
})
