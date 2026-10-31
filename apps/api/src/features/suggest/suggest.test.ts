import { describe, expect, it } from 'bun:test'
import type { LanguageModelRequest } from '@localixai/agent/runtime'

import type { ContextContribution } from '@localixai/mini-app-sdk/backend'
import {
  renderSessionDigest,
  clip,
  LAST_TURN_TAIL_BYTES,
  MAX_DIGEST_TURNS,
  PER_TURN_BYTES,
} from './digest'
import { coreInlineCompletionSurface, cleanInlineCompletion } from './surfaces'
import { createInlineCompletionService, type InlineCompletionServiceDeps } from './service'
import { SURFACE_CONTEXT_BYTE_CEILING } from './surfaces'

/** A surface's own grounding, in the shape `resolveContext` returns. */
const own = (content: string): ContextContribution[] => [
  {
    id: 'own',
    providerId: 'test',
    providerVersion: '1',
    scope: 'session',
    kind: 'test',
    content,
    priority: 1000,
    sensitivity: 'project',
  },
]

describe('surface context renderers', () => {
  it('bounds and renders the chat session digest', () => {
    expect(renderSessionDigest({ turns: [] })).toBe('')
    const turns = Array.from({ length: MAX_DIGEST_TURNS + 2 }, (_, index) => ({
      role: 'user' as const,
      text: `turn-${index} ${'x'.repeat(PER_TURN_BYTES + 40)}`,
    }))
    const output = renderSessionDigest({ turns })
    expect(output).not.toContain('turn-0')
    expect(output).toContain(`turn-${MAX_DIGEST_TURNS + 1}`)
    expect(clip('a  b\n\nc', 100)).toBe('a b c')
  })

  it('bounds chat context and drafts by UTF-8 bytes for non-ASCII input', () => {
    const turn = clip('🙂'.repeat(500), PER_TURN_BYTES)
    expect(Buffer.byteLength(turn, 'utf8')).toBeLessThanOrEqual(PER_TURN_BYTES)
    expect(turn).toEndWith('…')

    const output = renderSessionDigest({
      turns: Array.from({ length: MAX_DIGEST_TURNS }, () => ({
        role: 'user' as const,
        text: 'έλεγξε το πλαίσιο '.repeat(200),
      })),
    })
    // Every turn head-clipped, except the last, kept from its end — and the bound is THEIR sum.
    const bound = (MAX_DIGEST_TURNS - 1) * PER_TURN_BYTES + LAST_TURN_TAIL_BYTES + 200
    expect(Buffer.byteLength(output, 'utf8')).toBeLessThan(bound)
  })

  it('keeps the END of the last turn — where the question a reply answers is', () => {
    const output = renderSessionDigest({
      turns: [
        { role: 'user', text: 'Explain vocabulary activation' },
        {
          role: 'assistant',
          text: `${'Long explanation. '.repeat(200)}Want to go through concrete exercises?`,
        },
      ],
    })
    expect(output).toContain('Want to go through concrete exercises?')
    expect(output).toContain('Assistant: …')
  })
})

describe('parseSurfaceLines', () => {})

describe('text-input surface adapters', () => {
  it('chat works from conversation context or a draft', () => {
    const surface = coreInlineCompletionSurface('chat')!
    expect(surface.actionable({ draft: '' }, '')).toBe(false)
    expect(surface.actionable({ draft: '' }, 'Recent conversation')).toBe(true)
    expect(surface.actionable({ draft: 'fix' }, '')).toBe(true)
    expect(surface.buildFragment({ draft: 'fix' }, 'Task context: ship')).toContain(
      'Current chat input: "fix"',
    )
  })

  it('normalizes full replies and suffix replies into append-only text', () => {
    expect(cleanInlineCompletion('fix the build and rerun CI', 'fix the build')).toBe(
      ' and rerun CI',
    )
    expect(cleanInlineCompletion(' and rerun CI', 'fix the build')).toBe(' and rerun CI')
    expect(cleanInlineCompletion('(ui): add completion', 'feat')).toBe('(ui): add completion')
    expect(cleanInlineCompletion('fix the build', 'fix the build')).toBe('')
    expect(cleanInlineCompletion('no suggestion', 'fix')).toBe('')
  })
})

describe('createInlineCompletionService', () => {
  const route = { providerConnectionId: 'conn', modelId: 'aux-model' }
  const FIXTURE_SURFACE = 'fixture.commit'
  const fixtureSurface = {
    id: FIXTURE_SURFACE,
    resolveContext: async () => own('Diff:\n+completion'),
    actionable: (_payload: unknown, context: string) => Boolean(context.trim()),
    buildFragment: (_payload: unknown, context: string) => context,
    instruction: () => 'one conventional commit subject',
    clean: (raw: string) => raw.trim(),
  }

  function makeDeps(
    reply: string,
    capture: { requests: LanguageModelRequest[]; usage: number },
    completeImpl?: (request: LanguageModelRequest) => Promise<any>,
  ): InlineCompletionServiceDeps {
    return {
      readAgentSettings: async () => ({
        modelRouting: { inlineCompletion: { enabled: true, ...route } },
      }),
      getSessionModel: async () => null,
      buildLanguageModel: (async () => ({
        providerConnectionId: 'conn',
        model: {
          complete: async (request: LanguageModelRequest) => {
            capture.requests.push(request)
            if (completeImpl) return completeImpl(request)
            return { content: reply, usage: { inputTokens: 10, outputTokens: 5 } }
          },
        },
      })) as unknown as InlineCompletionServiceDeps['buildLanguageModel'],
      resolveContext: async (_userId, _sessionId, request) =>
        own(request.surface === 'chat' ? 'Task context: ship it' : 'Diff:\n+completion'),
      // A CONTRIBUTED surface, because that is what every non-chat surface is now. The guarantees
      // below matter more for one of these than they ever did for a core surface: the code that can
      // throw belongs to a plugin, and it must not be able to take the chat completion with it.
      contributedSurface: (id) => (id === FIXTURE_SURFACE ? fixtureSurface : undefined),
      recordUsage: () => {
        capture.usage++
      },
    }
  }

  it('serves a core and a contributed surface in one model call, recording usage once', async () => {
    const capture = { requests: [] as LanguageModelRequest[], usage: 0 }
    const service = createInlineCompletionService(
      makeDeps(`chat: " the tests"\n${FIXTURE_SURFACE}: "(ui): add ghost text"`, capture),
    )
    const output = await service.complete('u1', {
      sessionId: 's1',
      surfaces: {
        chat: { draft: 'run' },
        [FIXTURE_SURFACE]: { draft: 'feat' },
      },
    })

    // The whole point of the shared call: N active inputs, one round-trip, one usage row —
    // and it must still hold when the inputs belong to different owners.
    expect(output).toEqual({ chat: ' the tests', [FIXTURE_SURFACE]: '(ui): add ghost text' })
    expect(capture.requests).toHaveLength(1)
    expect(capture.usage).toBe(1)
    expect(capture.requests[0]!.maxOutputTokens).toBe(128)
    expect(capture.requests[0]!.reasoningEffort).toBe('off')
    const input = capture.requests[0]!.messages[0]!.content
    expect(input).toContain('Surface "chat"')
    expect(input).toContain(`Surface "${FIXTURE_SURFACE}"`)
  })

  // The ceilings bounded what their PRODUCERS emit; nothing checked the value arriving at the
  // prompt. Measured before the seam existed: a 2 MB context produced a 1953 KiB prompt. And the
  // clip then lived in the CHAT surface only — a contributed surface's context went through whole
  // while the declared budget assumed it was clipped. The service now clips every surface.
  it("clips every surface's own context to one ceiling, core's and a plugin's alike", async () => {
    const capture = { requests: [] as LanguageModelRequest[], usage: 0 }
    const deps = makeDeps(`chat: " x"\n${FIXTURE_SURFACE}: "y"`, capture)
    // The service asks this one resolver for EVERY surface's grounding, the plugin's included.
    deps.resolveContext = async () => own(`start\n${'x'.repeat(2_000_000)}`)
    await createInlineCompletionService(deps).complete('u1', {
      sessionId: 's1',
      surfaces: { chat: { draft: 'run' }, [FIXTURE_SURFACE]: { draft: 'feat' } },
    })
    const input = capture.requests[0]!.messages[0]!.content as string
    expect(input.match(/context truncated/g)).toHaveLength(2)
    expect(Buffer.byteLength(input, 'utf8')).toBeLessThan(2 * SURFACE_CONTEXT_BYTE_CEILING + 8_000)
  })

  it('resolves the shared working set through Fabric once and renders it once', async () => {
    const capture = { requests: [] as LanguageModelRequest[], usage: 0 }
    const deps = makeDeps(`chat: " x"\n${FIXTURE_SURFACE}: "y"`, capture)
    const destinations: string[] = []
    deps.contextManager = {
      collect: async (_request, explicit) => ({
        contributions: [...explicit],
        dropped: [],
        diagnostics: { droppedByReason: {} },
        bytes: 0,
        providerOutcomes: [],
      }),
      resolveExplicit: async (request, references) => {
        destinations.push(request.destination)
        return {
          contributions: references.map((reference) => ({
            id: `c:${reference.id}`,
            providerId: 'p',
            providerVersion: '1',
            scope: 'session' as const,
            kind: 'file',
            uri: 'src/billing.ts',
            content: 'export function refundInvoice(invoice) {}',
            priority: 1000,
            sensitivity: 'project' as const,
          })),
          dropped: [],
          diagnostics: { droppedByReason: {} },
          bytes: 0,
          providerOutcomes: [],
          referenceOutcomes: references.map((reference) => ({
            referenceId: reference.id,
            status: 'resolved' as const,
            contributionIds: [`c:${reference.id}`],
          })),
        }
      },
    }
    await createInlineCompletionService(deps).complete('u1', {
      sessionId: 's1',
      references: [
        { kind: 'file', token: '@file:src/billing.ts', label: 'billing.ts', origin: 'ambient' },
      ],
      surfaces: { chat: { draft: 'refund the invoice' }, [FIXTURE_SURFACE]: { draft: 'fix' } },
    })
    const input = capture.requests[0]!.messages[0]!.content as string
    expect(destinations).toEqual(['inline-completion'])
    expect(input.match(/What the user is working with/g)).toHaveLength(1)
    expect(input).toContain('refundInvoice')
  })

  it('ignores a surface nobody owns instead of failing the whole call', async () => {
    // A stale client, or a plugin the user just disabled. The other surfaces still answer.
    const capture = { requests: [] as LanguageModelRequest[], usage: 0 }
    const output = await createInlineCompletionService(
      makeDeps('chat: " the tests"', capture),
    ).complete('u1', {
      sessionId: 's1',
      surfaces: { chat: { draft: 'run' }, 'gone.surface': { draft: 'x' } },
    })

    expect(output).toEqual({ chat: ' the tests' })
    expect(capture.requests[0]!.messages[0]!.content).not.toContain('gone.surface')
  })

  // "Fail closed per surface" was only true of the context READ. The surface-owned functions ran
  // unguarded inside a `Promise.all`, in a function with no `catch` — so one throw rejected the
  // whole RPC and the client lost BOTH surfaces plus a retry from its budget. A cleaner throwing
  // was worse still: the model call was already billed. Now that a surface can come from a plugin,
  // the throwing code is not even ours.
  describe('one broken surface cannot take the other down', () => {
    const withBrokenSpec = async <T>(
      stage: 'buildFragment' | 'clean',
      body: () => Promise<T>,
    ): Promise<T> => {
      const original = fixtureSurface[stage]
      ;(fixtureSurface as Record<string, unknown>)[stage] = () => {
        throw new Error(`boom in ${stage}`)
      }
      try {
        return await body()
      } finally {
        ;(fixtureSurface as Record<string, unknown>)[stage] = original
      }
    }

    it('still completes chat when a contributed surface throws building its fragment', async () => {
      const capture = { requests: [] as LanguageModelRequest[], usage: 0 }
      const output = await withBrokenSpec('buildFragment', () =>
        createInlineCompletionService(makeDeps('chat: " the tests"', capture)).complete('u1', {
          sessionId: 's1',
          surfaces: { chat: { draft: 'run' }, [FIXTURE_SURFACE]: { draft: 'feat' } },
        }),
      )

      expect(output).toEqual({ chat: ' the tests' })
      // The call went out for the surviving surface only — not skipped, not doubled.
      expect(capture.requests).toHaveLength(1)
      expect(capture.requests[0]!.messages[0]!.content).not.toContain(FIXTURE_SURFACE)
    })

    it('keeps the surfaces that cleaned when one cleaner throws after the model was billed', async () => {
      const capture = { requests: [] as LanguageModelRequest[], usage: 0 }
      const output = await withBrokenSpec('clean', () =>
        createInlineCompletionService(
          makeDeps(`chat: " the tests"\n${FIXTURE_SURFACE}: "(ui): add ghost text"`, capture),
        ).complete('u1', {
          sessionId: 's1',
          surfaces: { chat: { draft: 'run' }, [FIXTURE_SURFACE]: { draft: 'feat' } },
        }),
      )

      expect(output).toEqual({ chat: ' the tests' })
      // Both surfaces were asked for and paid for; only the broken one is missing.
      expect(capture.requests[0]!.messages[0]!.content).toContain(FIXTURE_SURFACE)
      expect(capture.usage).toBe(1)
    })
  })

  it('requests minimum reasoning instead of inherited session effort', async () => {
    const capture = { requests: [] as LanguageModelRequest[], usage: 0 }
    const deps = makeDeps(`${FIXTURE_SURFACE}: feat(core): finish model routing`, capture)
    deps.getSessionModel = async () => ({
      providerConnectionId: 'session-connection',
      modelId: 'session-model',
      reasoningEffort: 'high',
    })

    await createInlineCompletionService(deps).complete('u1', {
      sessionId: 's1',
      surfaces: { [FIXTURE_SURFACE]: { draft: '' } },
    })

    expect(capture.requests).toHaveLength(1)
    expect(capture.requests[0]!.reasoningEffort).toBe('off')
  })

  it('drops non-actionable surfaces without a provider call', async () => {
    const capture = { requests: [] as LanguageModelRequest[], usage: 0 }
    const deps = makeDeps('chat: x', capture)
    deps.resolveContext = async () => []
    const service = createInlineCompletionService(deps)
    expect(
      await service.complete('u1', { sessionId: 's1', surfaces: { chat: { draft: '' } } }),
    ).toEqual({})
    expect(capture.requests).toHaveLength(0)
  })

  it('short-circuits an off route before resolving rich context', async () => {
    const capture = { requests: [] as LanguageModelRequest[], usage: 0 }
    const deps = makeDeps(`${FIXTURE_SURFACE}: feat: should not run`, capture)
    let contextReads = 0
    deps.readAgentSettings = async () => ({
      modelRouting: { inlineCompletion: { enabled: false } },
    })
    deps.resolveContext = async () => {
      contextReads++
      return own('expensive repository diff')
    }

    const output = await createInlineCompletionService(deps).complete('u1', {
      sessionId: 's1',
      surfaces: { [FIXTURE_SURFACE]: { draft: '' } },
    })

    expect(output).toEqual({})
    expect(contextReads).toBe(0)
    expect(capture.requests).toHaveLength(0)
  })

  it('propagates abort to the provider and fails closed', async () => {
    const capture = { requests: [] as LanguageModelRequest[], usage: 0 }
    const controller = new AbortController()
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const service = createInlineCompletionService(
      makeDeps('chat: late', capture, (request) => {
        entered()
        return new Promise((resolve) => {
          request.signal?.addEventListener('abort', () => resolve({ content: 'chat: late' }))
        })
      }),
    )
    const pending = service.complete(
      'u1',
      { sessionId: 's1', surfaces: { chat: { draft: 'run' } } },
      controller.signal,
    )
    await started
    controller.abort()
    expect(await pending).toEqual({})
    expect(capture.requests[0]!.signal?.aborted).toBe(true)
    expect(capture.usage).toBe(0)
  })

  it('bounds a hanging provider by the deadline', async () => {
    const capture = { requests: [] as LanguageModelRequest[], usage: 0 }
    const service = createInlineCompletionService(
      makeDeps('x', capture, () => new Promise(() => {})),
    )
    // Long enough for the provider call to start on a loaded CI runner: at 10ms the work before
    // it could spend the whole deadline, so the provider was never reached and never aborted.
    const output = await service.complete(
      'u1',
      { sessionId: 's1', surfaces: { chat: { draft: 'run' } } },
      undefined,
      Date.now() + 250,
    )
    expect(output).toEqual({})
    expect(capture.requests[0]!.signal?.aborted).toBe(true)
  })

  it('bounds a hanging rich-context read inside the same end-to-end deadline', async () => {
    const capture = { requests: [] as LanguageModelRequest[], usage: 0 }
    const deps = makeDeps(`${FIXTURE_SURFACE}: feat: late`, capture)
    deps.resolveContext = async () => new Promise<ContextContribution[]>(() => {})
    const service = createInlineCompletionService(deps)

    const output = await service.complete(
      'u1',
      {
        sessionId: 's1',
        surfaces: { [FIXTURE_SURFACE]: { draft: '' } },
      },
      undefined,
      Date.now() + 10,
    )

    expect(output).toEqual({})
    expect(capture.requests).toHaveLength(0)
  })

  it('bounds a hanging settings read inside the same end-to-end deadline', async () => {
    const capture = { requests: [] as LanguageModelRequest[], usage: 0 }
    const deps = makeDeps(`${FIXTURE_SURFACE}: feat: late`, capture)
    deps.readAgentSettings = async () => new Promise(() => {})

    const output = await createInlineCompletionService(deps).complete(
      'u1',
      { sessionId: 's1', surfaces: { chat: { draft: 'run' } } },
      undefined,
      Date.now() + 10,
    )

    expect(output).toEqual({})
    expect(capture.requests).toHaveLength(0)
  })

  it('bounds hanging model resolution inside the same end-to-end deadline', async () => {
    const capture = { requests: [] as LanguageModelRequest[], usage: 0 }
    const deps = makeDeps(`${FIXTURE_SURFACE}: feat: late`, capture)
    deps.buildLanguageModel = (() => new Promise(() => {})) as typeof deps.buildLanguageModel

    const output = await createInlineCompletionService(deps).complete(
      'u1',
      { sessionId: 's1', surfaces: { chat: { draft: 'run' } } },
      undefined,
      Date.now() + 10,
    )

    expect(output).toEqual({})
    expect(capture.requests).toHaveLength(0)
  })

  it('propagates caller cancellation into rich-context resolution', async () => {
    const capture = { requests: [] as LanguageModelRequest[], usage: 0 }
    const deps = makeDeps(`${FIXTURE_SURFACE}: feat: late`, capture)
    let contextSignal: AbortSignal | undefined
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    deps.resolveContext = async (_userId, _sessionId, _request, signal) => {
      contextSignal = signal
      entered()
      return new Promise<ContextContribution[]>(() => {})
    }
    const controller = new AbortController()
    const pending = createInlineCompletionService(deps).complete(
      'u1',
      {
        sessionId: 's1',
        surfaces: { [FIXTURE_SURFACE]: { draft: '' } },
      },
      controller.signal,
    )
    await started

    controller.abort()

    expect(await pending).toEqual({})
    expect(contextSignal?.aborted).toBe(true)
    expect(capture.requests).toHaveLength(0)
  })
})

describe('buildInlineCompletionPrompt', () => {})
