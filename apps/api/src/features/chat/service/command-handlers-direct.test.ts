import { describe, expect, test } from 'bun:test'

import { __resetCapabilityRevision } from '../../capabilities/revision'
import type { SessionRecord } from '../repository'
import { createRunScopeCache } from '../runtime/run-scope'
import { handleControlCommand } from './command-handlers'
import type { CommandHandlerContext } from './command-handlers-context'
import { createChatServiceGraph } from './service-graph'
import { testChatFeaturePorts } from '../test-harness'

const session = { id: 's', userId: 'u', title: 'Chat' } as SessionRecord

function directContext(opts: {
  activeUsage?: {
    turns: number
    subscriptionCost: number
    usage?: { inputTokens?: number; totalTokens?: number; isSummary?: boolean }
  }
  onProjection?: () => void
  replies: string[]
}): CommandHandlerContext {
  return {
    repo: {
      listMessages: async () => {
        throw new Error('direct slash replies must not hydrate the transcript')
      },
      getActiveBranchUsage: async () => {
        opts.onProjection?.()
        return opts.activeUsage ?? { turns: 0, subscriptionCost: 0 }
      },
    },
    usageRepo: { queryStats: async () => [] },
    runner: {
      isBusy: () => false,
    },
    now: () => '2026-07-31T00:00:00.000Z',
    insertDirectReply: async (
      _userId: string,
      sessionId: string,
      _prompt: string,
      replyText: string,
    ) => {
      opts.replies.push(replyText)
      return { sessionId, messageId: 'reply' }
    },
  } as unknown as CommandHandlerContext
}

describe('direct slash-command transcript reads', () => {
  test('/help replies without loading messages or the usage projection', async () => {
    const replies: string[] = []
    let projectionCalls = 0
    const result = await handleControlCommand(
      directContext({
        replies,
        onProjection: () => {
          projectionCalls += 1
        },
      }),
      'u',
      's',
      session,
      '/help',
    )

    expect(result).toEqual({ sessionId: 's', messageId: 'reply' })
    expect(replies[0]).toContain('**Slash commands**')
    expect(projectionCalls).toBe(0)
  })

  test('/usage reads the covering projection instead of message payloads', async () => {
    const replies: string[] = []
    let projectionCalls = 0
    await handleControlCommand(
      directContext({
        replies,
        activeUsage: {
          turns: 1,
          subscriptionCost: 0,
          usage: { inputTokens: 25, totalTokens: 25, isSummary: true },
        },
        onProjection: () => {
          projectionCalls += 1
        },
      }),
      'u',
      's',
      session,
      '/usage',
    )

    expect(projectionCalls).toBe(1)
    expect(replies[0]).toContain('- Assistant turns: 1')
    expect(replies[0]).toContain('- Total tokens: 25')
  })

  test('/plugin reload makes file edits visible to the next run scope', async () => {
    __resetCapabilityRevision()
    const scope = { userId: 'u', projectId: '', cwd: '/repo', agentId: 'builtin:localix' }
    const cache = createRunScopeCache<string[]>()
    let edited = false
    let loads = 0
    const loadTools = async () => {
      loads += 1
      return edited ? ['edited_tool'] : []
    }
    const { pluginService } = testChatFeaturePorts({} as never)
    const ctx = directContext({ replies: [] })
    ctx.pluginService = pluginService

    expect(await cache.resolve(scope, loadTools)).toEqual([])
    edited = true
    await handleControlCommand(ctx, 'u', 's', session, '/plugin reload')

    expect(await cache.resolve(scope, loadTools)).toEqual(['edited_tool'])
    expect(loads).toBe(2)
  })

  /**
   * ONE plugin service per process. The graph used to always build its own, so a running
   * app had two — two inspection caches importing the same plugins, and two `onChanged`
   * owners where only the host's reconciled the live channel/backend/monitor hosts. The
   * host now injects its service; the graph builds one only when nobody supplied it.
   */
  test('the chat graph uses the host plugin service when it is given one', () => {
    const host = { marker: 'host-owned' } as never
    const ports = testChatFeaturePorts({} as never, { pluginService: host })
    const graph = createChatServiceGraph({ db: {}, runner: {}, ports } as never)
    expect(graph.pluginService).toBe(host)
  })
})
