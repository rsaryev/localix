import { describe, expect, it } from 'bun:test'
import type { LanguageModelRequest } from '@localixai/agent/runtime'

import type { ContextContribution } from '@localixai/mini-app-sdk/backend'
import { createInlineCompletionService, type InlineCompletionServiceDeps } from './service'

const own = (content: string): readonly ContextContribution[] => [
  {
    id: 'conversation:s1',
    providerId: 'localix.chat',
    providerVersion: '1',
    scope: 'session',
    kind: 'conversation',
    content,
    priority: 1000,
    sensitivity: 'project',
  },
]

/** A service over a fake model that counts its calls and their spend. */
function harness(reply: () => unknown = () => 'chat: "Yes, let\'s do it"') {
  const calls: LanguageModelRequest[] = []
  let usage = 0
  let context = 'Assistant: …Want to go through concrete exercises?'
  const deps: InlineCompletionServiceDeps = {
    readAgentSettings: async () => ({
      modelRouting: {
        inlineCompletion: { enabled: true, providerConnectionId: 'conn', modelId: 'aux' },
      },
    }),
    getSessionModel: async () => null,
    buildLanguageModel: (async () => ({
      providerConnectionId: 'conn',
      model: {
        complete: async (request: LanguageModelRequest) => {
          calls.push(request)
          return { content: await reply(), usage: { inputTokens: 10, outputTokens: 5 } }
        },
      },
    })) as unknown as InlineCompletionServiceDeps['buildLanguageModel'],
    resolveContext: async () => own(context),
    recordUsage: () => {
      usage++
    },
  }
  const service = createInlineCompletionService(deps)
  const ask = (signal?: AbortSignal) =>
    service.completeDetailed('u1', { sessionId: 's1', surfaces: { chat: { draft: '' } } }, signal)
  return {
    ask,
    calls,
    usage: () => usage,
    setContext: (next: string) => {
      context = next
    },
  }
}

describe('the inline completion answer cache', () => {
  it('the same question on the same model is answered once, and billed once', async () => {
    const h = harness()
    const first = await h.ask()
    const again = await h.ask()
    expect(first.completions).toEqual({ chat: "Yes, let's do it" })
    expect(again).toMatchObject({ outcome: 'suggested', completions: first.completions })
    expect(h.calls).toHaveLength(1)
    expect(h.usage()).toBe(1)
  })

  it('a new last message is a new question', async () => {
    const h = harness()
    await h.ask()
    h.setContext('Assistant: Done — the build is green.')
    await h.ask()
    expect(h.calls).toHaveLength(2)
  })

  it('two askers at once share one call', async () => {
    const release = Promise.withResolvers<string>()
    const h = harness(() => release.promise)
    const a = h.ask()
    const b = h.ask()
    // One event-loop turn: both askers are in before the model answers.
    await new Promise((resolve) => setTimeout(resolve, 0))
    release.resolve('chat: "Yes"')
    expect((await a).completions).toEqual({ chat: 'Yes' })
    expect((await b).completions).toEqual({ chat: 'Yes' })
    expect(h.calls).toHaveLength(1)
  })

  it('a failure is never kept: the next ask calls the model again', async () => {
    let fail = true
    const h = harness(() => {
      if (fail) throw new Error('provider down')
      return 'chat: "Yes"'
    })
    expect((await h.ask()).outcome).toBe('error')
    fail = false
    expect((await h.ask()).completions).toEqual({ chat: 'Yes' })
    expect(h.calls).toHaveLength(2)
  })

  it("the model's confident nothing is kept too — a repeat does not pay to hear it again", async () => {
    const h = harness(() => 'chat: ""')
    expect((await h.ask()).outcome).toBe('empty')
    expect((await h.ask()).outcome).toBe('empty')
    expect(h.calls).toHaveLength(1)
  })
})

describe('a reply in content blocks', () => {
  it('reads only the text blocks, joined in order', async () => {
    const h = harness(() => [
      { type: 'thinking', thinking: 'chat: "no"' },
      { type: 'text', text: 'chat: "Ye' },
      { type: 'text', text: 's"' },
    ])
    expect((await h.ask()).completions).toEqual({ chat: 'Yes' })
  })
})

describe('the empty-composer prompt', () => {
  it('asks for the reply to the last message, not a new task', async () => {
    const h = harness()
    await h.ask()
    const input = h.calls[0]!.messages[0]!.content as string
    expect(input).toContain('most likely short reply to the assistant’s LAST message')
    expect(input).toContain('Want to go through concrete exercises?')
  })
})
