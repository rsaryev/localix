import { describe, expect, test } from 'bun:test'
import type {
  AgentEvent as PiAgentEvent,
  AgentMessage as PiAgentMessage,
} from '@earendil-works/pi-agent-core'
import {
  registerSessionResourceCleanup,
  type AssistantMessage as PiAssistantMessage,
} from '@earendil-works/pi-ai'
import { z } from 'zod'

import {
  attachProviderResponse,
  classifyAgentError,
  createHumanInLoopController,
  mcpInputSchema,
  type AgentEvent,
  type AgentTool,
  type AgentToolResult,
} from '@localixai/agent/agents'

import { mapEvent } from './event-codec'
import {
  createPiAgentRuntime,
  enqueueRuntimeEvent,
  normalizeEventBufferCapacity,
  shouldStopForTurnBudget,
  toPiMessages,
} from './runtime'
import { revealActivatedModelTools } from './run-tools'
import { withPiRunStreamOptions } from './stream-options'
import { BoundedEventBuffer } from './bounded-event-buffer'
import type { AgentRuntimeRunInput } from '@localixai/agent/runtime'
import { applyAfterToolCall, applyBeforeToolCall, toPiTool } from './tool-bridge'
import { mapAssistantDelta } from './message-codec'

/** The `onResponse` hook is handed the model it fired for; nothing here reads it. */
const model = () => ({}) as never

function assistant(stopReason: PiAssistantMessage['stopReason']): PiAssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: 'openai-completions',
    provider: 'test',
    model: 'test',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: 0,
  }
}

describe('pi runtime event bridge', () => {
  test('maps each text chunk with one indexed part read and no cumulative content scan', () => {
    const chunkCount = 4_096
    let indexedReads = 0
    let iterations = 0
    const content = new Proxy([{ type: 'text', text: '' }] as PiAssistantMessage['content'], {
      get(target, property, receiver) {
        if (property === Symbol.iterator || property === 'map') {
          iterations += 1
          throw new Error('cumulative content was scanned')
        }
        if (property === '0') indexedReads += 1
        return Reflect.get(target, property, receiver)
      },
    })
    const partial = { ...assistant('stop'), content }

    for (let index = 0; index < chunkCount; index++) {
      expect(
        mapAssistantDelta({
          type: 'text_delta',
          contentIndex: 0,
          delta: 'x',
          partial,
        }),
      ).toMatchObject({
        kind: 'text',
        phase: 'delta',
        contentIndex: 0,
        delta: 'x',
        origin: { model: 'test' },
      })
    }

    expect(indexedReads).toBe(chunkCount)
    expect(iterations).toBe(0)
  })

  test('maps progressive tool-call input without carrying a cumulative message snapshot', () => {
    const partial: PiAssistantMessage = {
      ...assistant('toolUse'),
      content: [
        {
          type: 'toolCall',
          id: 'call-1',
          name: 'read',
          arguments: { path: 'src/a.ts' },
          thoughtSignature: 'sig',
        },
      ],
    }

    const mapped = mapEvent(
      {
        type: 'message_update',
        message: partial,
        assistantMessageEvent: {
          type: 'toolcall_delta',
          contentIndex: 0,
          delta: '"src/a.ts"',
          partial,
        },
      },
      { index: 1, terminated: false },
    )

    expect(mapped).toEqual([
      {
        type: 'message_update',
        delta: {
          kind: 'tool_call',
          phase: 'delta',
          contentIndex: 0,
          delta: '"src/a.ts"',
          id: 'call-1',
          name: 'read',
          input: { path: 'src/a.ts' },
          origin: {
            api: 'openai-completions',
            provider: 'test',
            model: 'test',
          },
          thoughtSignature: 'sig',
        },
      },
    ])
    expect(mapped[0]).not.toHaveProperty('message')
  })

  test('delegates durable session disposal to Pi session resources', async () => {
    const disposed: Array<string | undefined> = []
    const unregister = registerSessionResourceCleanup((sessionId) => {
      disposed.push(sessionId)
    })

    try {
      await createPiAgentRuntime().disposeSession('LOCALIX-dispose')
    } finally {
      unregister()
    }

    expect(disposed).toEqual(['LOCALIX-dispose'])
  })

  test('coalesces pending progress snapshots without dropping lifecycle events', async () => {
    const queue = new BoundedEventBuffer<AgentEvent>(3)
    await enqueueRuntimeEvent(
      queue,
      {
        type: 'tool_execution_start',
        toolCallId: 'call-1',
        toolName: 'bash',
        input: {},
      },
      false,
    )
    await enqueueRuntimeEvent(
      queue,
      { type: 'tool_execution_update', toolCallId: 'call-1', details: { output: 'old' } },
      false,
    )
    await enqueueRuntimeEvent(
      queue,
      { type: 'tool_execution_update', toolCallId: 'call-1', details: { output: 'latest' } },
      false,
    )
    await enqueueRuntimeEvent(
      queue,
      {
        type: 'tool_execution_end',
        toolCallId: 'call-1',
        toolName: 'bash',
        result: { content: 'done' },
      },
      false,
    )

    expect(queue.length).toBe(3)
    expect([queue.shift(), queue.shift(), queue.shift()]).toMatchObject([
      { type: 'tool_execution_start' },
      { type: 'tool_execution_update', details: { output: 'latest' } },
      { type: 'tool_execution_end' },
    ])
  })

  test('keeps one pending progress slot when lifecycle events fill the buffer', async () => {
    const queue = new BoundedEventBuffer<AgentEvent>(1)
    await enqueueRuntimeEvent(
      queue,
      {
        type: 'tool_execution_start',
        toolCallId: 'call-1',
        toolName: 'bash',
        input: {},
      },
      false,
    )
    let firstSettled = false
    const first = enqueueRuntimeEvent(
      queue,
      { type: 'tool_execution_update', toolCallId: 'call-1', details: { output: 'old' } },
      true,
    ).then(() => {
      firstSettled = true
    })

    await Promise.resolve()
    expect(firstSettled).toBe(false)
    await enqueueRuntimeEvent(
      queue,
      { type: 'tool_execution_update', toolCallId: 'call-1', details: { output: 'latest' } },
      true,
    )

    expect(queue.shift()).toMatchObject({ type: 'tool_execution_start' })
    await first
    expect(queue.shift()).toMatchObject({
      type: 'tool_execution_update',
      details: { output: 'latest' },
    })
  })

  test('repairs malformed tool history at the Localix-to-Pi boundary', () => {
    expect(
      toPiMessages([
        {
          role: 'assistant',
          content: [{ type: 'tool_call', id: 'crashed', name: 'bash', arguments: {} }],
          model: 'test-model',
          timestamp: 12,
        },
        {
          role: 'tool',
          results: [
            {
              type: 'tool_result',
              toolCallId: 'orphan',
              toolName: 'read',
              content: 'stale',
            },
          ],
          timestamp: 13,
        },
      ]),
    ).toMatchObject([
      { role: 'assistant', content: [{ type: 'toolCall', id: 'crashed', name: 'bash' }] },
      {
        role: 'toolResult',
        toolCallId: 'crashed',
        toolName: 'bash',
        content: [{ type: 'text', text: 'aborted' }],
        isError: true,
        timestamp: 12,
      },
    ])
  })

  test('rejects duplicate dispatch tool names instead of silently using the last one', async () => {
    const duplicated: AgentTool = {
      name: 'duplicate',
      description: 'duplicate test tool',
      inputSchema: z.object({}),
      executionMode: 'sequential',
      activeVerb: 'Testing',
      execute: async () => ({ content: 'ok' }),
    }
    const input = {
      sessionId: 'LOCALIX-duplicate-tools',
      systemPrompt: '',
      messages: [],
      model: { providerId: 'unused', modelId: 'unused' },
      credential: { type: 'api-key', key: 'unused' },
      tools: [],
      dispatchTools: [duplicated, { ...duplicated }],
    } satisfies AgentRuntimeRunInput
    const run = createPiAgentRuntime().run(input)

    const result = await run.result
    expect(result.terminal).toBe('failed')
    expect(result.error?.message).toBe('Duplicate dispatch tool names: duplicate')
  })

  test('reveals only dispatch-registered schemas returned by an activation tool', () => {
    const activator = {
      name: 'activate_tools',
      description: 'Activate tools',
      inputSchema: z.object({}),
      activeVerb: 'Activating',
      activatesTools: true,
      execute: async () => ({ content: 'ok' }),
    } satisfies AgentTool
    const deferred = {
      name: 'deferred_lookup',
      description: 'Query a database',
      inputSchema: z.object({ sql: z.string() }),
      activeVerb: 'Querying',
      execute: async () => ({ content: 'ok' }),
    } satisfies AgentTool
    const dispatchToolsByName = new Map<string, AgentTool>([
      [activator.name, activator],
      [deferred.name, deferred],
    ])
    const modelToolNames = new Set([activator.name])
    const modelTools = [activator.name]

    expect(
      revealActivatedModelTools({
        activator,
        result: {
          content: 'activated',
          details: { activated: ['deferred_lookup', 'not_registered', 'deferred_lookup'] },
        },
        dispatchToolsByName,
        modelToolNames,
        modelTools,
        toModelTool: (tool) => tool.name,
      }),
    ).toEqual(['deferred_lookup'])
    expect(modelTools).toEqual(['activate_tools', 'deferred_lookup'])
  })

  test('does not reveal schemas from ordinary or failed tools', () => {
    const ordinary = {
      name: 'ordinary',
      description: 'Ordinary tool',
      inputSchema: z.object({}),
      activeVerb: 'Running',
      execute: async () => ({ content: 'ok' }),
    } satisfies AgentTool
    const deferred = { ...ordinary, name: 'deferred_lookup' }
    const dispatchToolsByName = new Map([[deferred.name, deferred]])

    for (const result of [
      { content: 'spoofed', details: { activated: ['deferred_lookup'] } },
      { content: 'failed', isError: true, details: { activated: ['deferred_lookup'] } },
    ] satisfies AgentToolResult[]) {
      const modelTools: string[] = []
      expect(
        revealActivatedModelTools({
          activator: ordinary,
          result,
          dispatchToolsByName,
          modelToolNames: new Set(),
          modelTools,
          toModelTool: (tool) => tool.name,
        }),
      ).toEqual([])
      expect(modelTools).toEqual([])
    }
  })

  test('normalizes the optional event-buffer capacity without a synchronous constructor failure', () => {
    expect(normalizeEventBufferCapacity(undefined)).toEqual({ capacity: 256 })
    expect(normalizeEventBufferCapacity(8)).toEqual({ capacity: 8 })
    for (const invalid of [0, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const normalized = normalizeEventBufferCapacity(invalid)
      expect(normalized.capacity).toBe(256)
      expect(normalized.error).toBeInstanceOf(RangeError)
    }
  })

  test('settles invalid buffer configuration through result instead of throwing from run()', async () => {
    const runtime = createPiAgentRuntime({ maxBufferedEvents: Number.NaN })
    const input = {
      sessionId: 'LOCALIX-test',
      systemPrompt: '',
      model: { providerId: 'unused', modelId: 'unused' },
      credential: { type: 'api_key', apiKey: 'unused' },
      tools: [],
    } as unknown as AgentRuntimeRunInput

    const run = runtime.run(input)

    await Promise.resolve(
      expect(run.result).resolves.toMatchObject({
        terminal: 'failed',
        error: expect.any(RangeError),
      }),
    )
  })

  test('does not call a natural final answer max_turns at the exact boundary', () => {
    const turn = { index: 1, maxTurns: 1, terminated: false }
    expect(shouldStopForTurnBudget(turn, assistant('stop'))).toBe(false)
    expect(mapEvent({ type: 'agent_end', messages: [] }, turn)[0]).toMatchObject({
      type: 'agent_end',
      stopReason: 'completed',
    })
  })

  test('reports max_turns when the boundary prevents consuming tool results', () => {
    const turn = { index: 1, maxTurns: 1, terminated: false, budgetExhausted: false }
    const message = {
      ...assistant('toolUse'),
      content: [{ type: 'toolCall' as const, id: 'call-1', name: 'read', arguments: {} }],
    }
    turn.budgetExhausted = shouldStopForTurnBudget(turn, message)
    expect(turn.budgetExhausted).toBe(true)
    expect(mapEvent({ type: 'agent_end', messages: [] }, turn)[0]).toMatchObject({
      type: 'agent_end',
      stopReason: 'max_turns',
    })
  })

  test('lets a terminating tool finish naturally at the turn boundary', () => {
    const turn = { index: 1, maxTurns: 1, terminated: true }
    const message = {
      ...assistant('toolUse'),
      content: [{ type: 'toolCall' as const, id: 'call-1', name: 'finish', arguments: {} }],
    }
    expect(shouldStopForTurnBudget(turn, message)).toBe(false)
  })

  test('a mixed tool batch does not latch termination or bypass the turn budget', () => {
    const turn = { index: 1, maxTurns: 1, terminated: false, toolTerminations: [] as boolean[] }
    const completed = new Map()
    mapEvent(
      {
        type: 'tool_execution_end',
        toolCallId: 'finish',
        toolName: 'finish',
        result: { content: [{ type: 'text', text: 'done' }], terminate: true },
        isError: false,
      },
      turn,
      completed,
    )
    mapEvent(
      {
        type: 'tool_execution_end',
        toolCallId: 'read',
        toolName: 'read',
        result: { content: [{ type: 'text', text: 'data' }] },
        isError: false,
      },
      turn,
      completed,
    )
    mapEvent({ type: 'turn_end', message: assistant('toolUse'), toolResults: [] }, turn, completed)

    expect(turn.terminated).toBe(false)
    expect(
      shouldStopForTurnBudget(turn, {
        ...assistant('toolUse'),
        content: [{ type: 'toolCall' as const, id: 'next', name: 'read', arguments: {} }],
      }),
    ).toBe(true)
    expect(mapEvent({ type: 'agent_end', messages: [] }, turn)[0]).toMatchObject({
      stopReason: 'completed',
    })
  })

  test('an all-terminating tool batch earns tool_terminate', () => {
    const turn = { index: 1, terminated: false, toolTerminations: [true, true] }
    mapEvent({ type: 'turn_end', message: assistant('toolUse'), toolResults: [] }, turn)
    expect(turn.terminated).toBe(true)
    expect(mapEvent({ type: 'agent_end', messages: [] }, turn)[0]).toMatchObject({
      stopReason: 'tool_terminate',
    })
  })

  test('merges the runtime tuning and the retention this adapter derived', () => {
    // The retention itself is `cache-retention.test.ts`; what this pins is the MERGE — that
    // the derived value and the runtime's retry tuning reach the Pi stream options together,
    // without dropping the upstream per-request fields they sit beside.
    expect(
      withPiRunStreamOptions(
        { maxTokens: 1024, cacheRetention: 'short' },
        { sessionId: 'LOCALIX-42', promptCacheIdleMs: 10 * 60_000 },
        { maxRetries: 2, maxRetryDelayMs: 500 },
      ),
    ).toEqual({
      maxTokens: 1024,
      cacheRetention: 'long',
      maxRetries: 2,
      maxRetryDelayMs: 500,
      sessionId: 'LOCALIX-42',
    })
  })

  test('captures a provider REFUSAL so the rate-limit window survives flattening', async () => {
    // pi reduces every provider failure to a message string before it leaves the vendor
    // boundary, so `Retry-After` and the rate-limit reset headers are unrecoverable from the
    // error alone — and the cooldown that consumes them then falls back to a constant no
    // matter what the server said. pi's `onResponse` hook is the only surviving channel.
    const capture: { last?: { status: number; headers: Record<string, string> } } = {}
    const merged = withPiRunStreamOptions(
      { maxTokens: 1024 },
      { sessionId: 'LOCALIX-42' },
      { maxRetries: 2 },
      capture,
    )
    // A success is deliberately NOT kept: an Anthropic 200 also carries
    // `anthropic-ratelimit-*-reset`, which describes when a window replenishes — not an
    // instruction to wait.
    await merged.onResponse?.(
      { status: 200, headers: { 'anthropic-ratelimit-tokens-reset': 'x' } },
      model(),
    )
    expect(capture.last).toBeUndefined()

    await merged.onResponse?.({ status: 429, headers: { 'Retry-After': '900' } }, model())
    expect(capture.last).toEqual({ status: 429, headers: { 'Retry-After': '900' } })

    // A LATER SUCCESS CLEARS IT. pi's codex transport retries a 429 internally and then
    // succeeds, and the loop calls the stream function once per turn — so without this a turn-1
    // refusal would still be attached when turn 20 died of an idle timeout, reporting a
    // rate-limit window for a failure that is not one.
    await merged.onResponse?.({ status: 200, headers: {} }, model())
    expect(capture.last).toBeUndefined()

    await merged.onResponse?.({ status: 429, headers: { 'Retry-After': '900' } }, model())

    // And the classifier reads the window back off an error carrying that refusal.
    const flattened = attachProviderResponse(new Error('Rate limit exceeded'), capture.last!)
    expect(classifyAgentError(flattened).retryAfterMs).toBe(900_000)
  })

  test('an upstream per-request onResponse still runs', async () => {
    // The capture WRAPS the caller's hook; clobbering it would silently disable whatever the
    // caller installed — the same spread-order hazard the option merge above guards against.
    const seen: number[] = []
    const capture: { last?: { status: number; headers: Record<string, string> } } = {}
    const merged = withPiRunStreamOptions(
      { onResponse: (response) => void seen.push(response.status) },
      { sessionId: 's' },
      {},
      capture,
    )
    await merged.onResponse?.({ status: 429, headers: {} }, model())
    expect(seen).toEqual([429])
    expect(capture.last?.status).toBe(429)
  })

  test('without a capture object the options are untouched', () => {
    // The parameter is optional so the merge stays a pure function for every other caller.
    expect(
      withPiRunStreamOptions({ maxTokens: 8 }, { sessionId: 's' }, {}).onResponse,
    ).toBeUndefined()
  })

  test('closes a failed tool after emitting its diagnostic event', () => {
    const completed = new Map<string, AgentToolResult>([
      [
        'call-1',
        {
          content: 'failed locally',
          isError: true,
          error: { kind: 'execution', message: 'boom', userMessage: 'Boom' },
          supersedeKey: 'terminal:1',
          mutated: false,
          details: { source: 'local' },
          terminate: true,
          gateProvenance: { decision: 'session-grant' },
        },
      ],
    ])
    const event = {
      type: 'tool_execution_end',
      toolCallId: 'call-1',
      toolName: 'test_tool',
      result: {
        content: [{ type: 'text', text: 'failed locally' }],
        details: { exitCode: 1 },
      },
      isError: true,
    } satisfies PiAgentEvent

    const mapped = mapEvent(event, { index: 1, terminated: false }, completed)

    // One terminal event for a failed call, not an error event followed by an end event.
    expect(mapped.map(({ type }) => type)).toEqual(['tool_execution_end'])
    expect(mapped[0]).toMatchObject({
      type: 'tool_execution_end',
      result: {
        isError: true,
        error: { kind: 'execution', message: 'boom' },
        supersedeKey: 'terminal:1',
        mutated: false,
        details: { source: 'local' },
        terminate: true,
      },
      provenance: { decision: 'session-grant' },
    })
    expect(completed.size).toBe(0)
  })

  test('retains Localix tool result metadata until pi finalizes the call', async () => {
    const result: AgentToolResult = {
      content: 'nope',
      isError: true,
      supersedeKey: 'resource:1',
    }
    const localTool: AgentTool = {
      name: 'test_tool',
      activeVerb: 'Testing',
      description: 'test',
      inputSchema: z.object({}),
      async execute() {
        return result
      },
    }
    const completed = new Map<string, AgentToolResult>()
    const tool = toPiTool(localTool, undefined, completed)

    await tool.execute('call-1', {}, undefined)

    expect(completed.get('call-1')).toBe(result)
  })

  test('compacts only the model-facing copy and reports the byte-budget reason', () => {
    const marker = 'MODEL_SCHEMA_DESCRIPTION_MARKER'
    const inputSchema = z.object(
      Object.fromEntries(
        Array.from({ length: 200 }, (_, index) => [
          `field_${index}`,
          z.string().describe(`${marker}-${index}-${'x'.repeat(300)}`),
        ]),
      ),
    )
    const localTool: AgentTool = {
      name: 'large_tool',
      activeVerb: 'Testing',
      description: 'large schema',
      inputSchema,
      async execute() {
        return { content: 'ok' }
      },
    }
    const completed = new Map<string, AgentToolResult>()
    const dispatch = toPiTool(localTool, undefined, completed)
    let reason: string | undefined
    const model = toPiTool(localTool, undefined, completed, undefined, {
      modelSchema: true,
      onSchemaCompacted: (diagnostic) => {
        reason = diagnostic.reason
      },
    })

    expect(JSON.stringify(dispatch.parameters)).toContain(marker)
    expect(JSON.stringify(model.parameters)).not.toContain(marker)
    expect(
      new TextEncoder().encode(JSON.stringify(model.parameters)).byteLength,
    ).toBeLessThanOrEqual(32 * 1024)
    expect(reason).toBe('over_byte_budget')
  })

  test('preserves an MCP JSON schema through the Localix-to-pi model bridge', () => {
    const localTool: AgentTool = {
      name: 'mcp_grep_searchGitHub',
      activeVerb: 'Searching GitHub',
      description: 'Search public GitHub code',
      inputSchema: mcpInputSchema({
        type: 'object',
        properties: { query: { type: 'string', description: 'Search expression' } },
        required: ['query'],
      }),
      async execute() {
        return { content: 'ok' }
      },
    }

    const modelTool = toPiTool(localTool, undefined, new Map(), undefined, {
      modelSchema: true,
    })

    expect(modelTool.parameters).toMatchObject({
      type: 'object',
      properties: { query: { type: 'string', description: 'Search expression' } },
      required: ['query'],
      additionalProperties: false,
    })
  })

  test('runs the tool-owned guard before the host gate and retains its exact result', async () => {
    let hostGateCalled = false
    const guardedResult: AgentToolResult = {
      content: 'Read the file before overwriting it',
      isError: true,
      error: { kind: 'blocked', message: 'blind overwrite', userMessage: 'Read first' },
      details: { path: 'a.txt' },
      terminate: true,
    }
    const tool: AgentTool = {
      name: 'write',
      activeVerb: 'Writing',
      description: 'test',
      inputSchema: z.object({ path: z.string() }),
      guard: () => ({ block: true, result: guardedResult }),
      async execute() {
        throw new Error('must not execute')
      },
    }
    const completed = new Map<string, AgentToolResult>()
    const gates = new Map()

    const verdict = await applyBeforeToolCall({
      tool,
      toolCallId: 'guarded-1',
      toolName: tool.name,
      args: { path: 'a.txt' },
      signal: new AbortController().signal,
      beforeToolCall: async () => {
        hostGateCalled = true
        return undefined
      },
      completedTools: completed,
      gateDecisions: gates,
    })

    expect(verdict).toEqual({ block: true, reason: guardedResult.content })
    expect(hostGateCalled).toBe(false)
    expect(completed.get('guarded-1')).toBe(guardedResult)
  })

  test('retains permission notes and provenance and creates a typed blocked result', async () => {
    const completed = new Map<string, AgentToolResult>()
    const gates = new Map()
    const signal = new AbortController().signal

    expect(
      await applyBeforeToolCall({
        tool: undefined,
        toolCallId: 'allowed-1',
        toolName: 'bash',
        args: {},
        signal,
        beforeToolCall: async () => ({
          note: '[Approved]',
          provenance: { decision: 'user-approved' },
        }),
        completedTools: completed,
        gateDecisions: gates,
      }),
    ).toBeUndefined()
    expect(gates.get('allowed-1')).toEqual({
      note: '[Approved]',
      provenance: { decision: 'user-approved' },
    })

    const blocked = await applyBeforeToolCall({
      tool: undefined,
      toolCallId: 'blocked-1',
      toolName: 'bash',
      args: {},
      signal,
      beforeToolCall: async () => ({ block: true, blockedMessage: 'Denied by policy' }),
      completedTools: completed,
      gateDecisions: gates,
    })
    expect(blocked).toEqual({ block: true, reason: 'Denied by policy' })
    expect(completed.get('blocked-1')).toMatchObject({
      content: 'Denied by policy',
      isError: true,
      error: { kind: 'blocked', retryable: false, fatal: false },
    })

    // The person's sentence rides the error; the model's text stays the tool result.
    await applyBeforeToolCall({
      tool: undefined,
      toolCallId: 'declined-1',
      toolName: 'bash',
      args: {},
      signal,
      beforeToolCall: async () => ({
        block: true,
        refusal: 'human',
        blockedMessage: 'User declined bash.',
        personMessage: 'You declined bash',
      }),
      completedTools: completed,
      gateDecisions: gates,
    })
    expect(completed.get('declined-1')).toMatchObject({
      content: 'User declined bash.',
      error: {
        kind: 'blocked',
        message: 'User declined bash.',
        userMessage: 'You declined bash',
        personMessage: 'You declined bash',
        refusal: 'human',
      },
    })
  })

  test('applies host post-processing and approval notes at the pi tool boundary', async () => {
    const sources: NonNullable<AgentToolResult['sources']> = [
      {
        id: 'source-docs',
        kind: 'web',
        title: 'Primary docs',
        uri: 'https://example.com/docs',
        role: 'consulted',
        status: 'available',
      },
    ]
    const completed = new Map<string, AgentToolResult>([
      [
        'call-1',
        {
          content: 'original',
          sources,
          gateProvenance: { decision: 'user-approved' },
        },
      ],
    ])
    const gates = new Map([
      [
        'call-1',
        {
          note: '[Approved]',
          provenance: { decision: 'user-approved' as const },
        },
      ],
    ])

    const result = await applyAfterToolCall({
      toolCallId: 'call-1',
      toolName: 'bash',
      args: {},
      result: { content: [{ type: 'text', text: 'original' }] },
      isError: false,
      signal: new AbortController().signal,
      afterToolCall: async () => ({ content: 'patched', terminate: true }),
      completedTools: completed,
      gateDecisions: gates,
    })

    expect(result).toEqual({
      content: [
        { type: 'text', text: '[Approved]\n\n' },
        { type: 'text', text: 'patched' },
      ],
      isError: false,
      terminate: true,
    })
    expect(completed.get('call-1')).toMatchObject({
      content: '[Approved]\n\npatched',
      contentParts: [
        { type: 'text', text: '[Approved]\n\n' },
        { type: 'text', text: 'patched' },
      ],
      sources,
      gateProvenance: { decision: 'user-approved' },
      terminate: true,
    })

    const [terminal] = mapEvent(
      {
        type: 'tool_execution_end',
        toolCallId: 'call-1',
        toolName: 'bash',
        result: {
          content: [{ type: 'text', text: '[Approved]\n\npatched' }],
          terminate: true,
        },
        isError: false,
      },
      { index: 1, terminated: false },
      completed,
    )
    expect(terminal).toMatchObject({
      type: 'tool_execution_end',
      result: { sources },
    })
    expect(completed.size).toBe(0)
  })

  test('does not expose a post-processed result before the awaited host barrier settles', async () => {
    const completed = new Map<string, AgentToolResult>([['call-1', { content: 'full original' }]])
    let release!: () => void
    const durable = new Promise<void>((resolve) => {
      release = resolve
    })
    let exposed = false

    const pending = applyAfterToolCall({
      toolCallId: 'call-1',
      toolName: 'plugin_report',
      args: {},
      result: { content: [{ type: 'text', text: 'full original' }] },
      isError: false,
      signal: new AbortController().signal,
      afterToolCall: async () => {
        await durable
        return { content: '[bounded; tool_output(action="get", tool_call_id="call-1")]' }
      },
      completedTools: completed,
      gateDecisions: new Map(),
    }).then((result) => {
      exposed = true
      return result
    })

    await Promise.resolve()
    expect(exposed).toBe(false)
    release()
    expect(await pending).toMatchObject({
      content: [
        { type: 'text', text: '[bounded; tool_output(action="get", tool_call_id="call-1")]' },
      ],
    })
    expect(exposed).toBe(true)
  })

  test('drops a stale success snapshot when the host post-hook fails', () => {
    const completed = new Map<string, AgentToolResult>([['call-1', { content: 'success' }]])

    expect(
      applyAfterToolCall({
        toolCallId: 'call-1',
        toolName: 'bash',
        args: {},
        result: { content: [{ type: 'text', text: 'success' }] },
        isError: false,
        signal: new AbortController().signal,
        afterToolCall: async () => {
          throw new Error('post-hook failed')
        },
        completedTools: completed,
        gateDecisions: new Map(),
      }),
    ).rejects.toThrow('post-hook failed')
    expect(completed.has('call-1')).toBe(false)
  })

  test('serializes mutating path-scoped tools because pi has no conflict waves', () => {
    const tool: AgentTool = {
      name: 'write',
      activeVerb: 'Writing',
      description: 'test',
      inputSchema: z.object({}),
      executionMode: 'parallel',
      mutates: true,
      parallelScopePaths: () => ['/tmp/a'],
      async execute() {
        return { content: 'ok' }
      },
    }

    expect(toPiTool(tool, undefined, new Map()).executionMode).toBe('sequential')
  })

  test('sanitizes tool results and thrown errors before they cross the runtime boundary', async () => {
    const completed = new Map<string, AgentToolResult>()
    const leaking: AgentTool = {
      name: 'leaking',
      activeVerb: 'Testing',
      description: 'test',
      inputSchema: z.object({ fail: z.boolean().optional() }),
      async execute(_id, input) {
        if ((input as { fail?: boolean }).fail) throw new Error('echoed raw-secret')
        return { content: 'echoed raw-secret', details: { echoed: 'raw-secret' } }
      },
    }
    const context = {
      sanitizeResult: (result: AgentToolResult) => ({
        ...result,
        content: result.content.split('raw-secret').join('[vault-secret]'),
        details: { echoed: '[vault-secret]' },
      }),
      sanitizeError: (error: unknown) =>
        new Error((error as Error).message.split('raw-secret').join('[vault-secret]')),
    }
    const tool = toPiTool(leaking, context, completed)

    const result = await tool.execute('safe-call', {}, new AbortController().signal)
    expect(result.content).toEqual([{ type: 'text', text: 'echoed [vault-secret]' }])
    expect(JSON.stringify(completed.get('safe-call'))).not.toContain('raw-secret')
    expect(tool.execute('bad-call', { fail: true }, new AbortController().signal)).rejects.toThrow(
      'echoed [vault-secret]',
    )
  })

  test('bridges HITL request and response events around the real pending controller', async () => {
    const controller = createHumanInLoopController()
    const events: AgentEvent[] = []
    const localTool: AgentTool = {
      name: 'ask',
      activeVerb: 'Asking',
      description: 'test',
      inputSchema: z.object({}),
      async execute(toolCallId, _input, signal, _onUpdate, context) {
        const response = await context!.humanInLoop!.request<
          {
            id: string
            kind: 'ask'
            payload: { question: string }
            createdAt: number
          },
          {
            requestId: string
            kind: 'ask'
            payload: { answers: string[] }
            respondedAt: number
          }
        >(
          {
            id: toolCallId,
            kind: 'ask',
            payload: { question: 'Continue?' },
            createdAt: 1,
          },
          signal,
        )
        return { content: response.payload.answers.join(', ') }
      },
    }
    const tool = toPiTool(localTool, { humanInLoop: controller }, new Map(), async (event) => {
      events.push(event)
    })

    const execution = tool.execute('call-1', {}, new AbortController().signal)
    await Promise.resolve()
    expect(controller.getPending('call-1')).toBeDefined()
    expect(events[0]).toMatchObject({ type: 'human_in_loop_request', toolCallId: 'call-1' })

    controller.respond({
      requestId: 'call-1',
      kind: 'ask',
      payload: { answers: ['yes'] },
      respondedAt: 2,
    })
    await execution

    expect(events.map(({ type }) => type)).toEqual([
      'human_in_loop_request',
      'human_in_loop_response',
    ])
  })

  test('maps provider error and abort endings to truthful agent stop reasons', () => {
    for (const [piReason, localReason] of [
      ['error', 'stream_error'],
      ['aborted', 'aborted'],
    ] as const) {
      const turn: {
        index: number
        terminated: boolean
        terminalStopReason?: 'aborted' | 'stream_error'
      } = { index: 1, terminated: false }
      mapEvent({ type: 'message_end', message: assistant(piReason) as PiAgentMessage }, turn)
      expect(
        mapEvent({ type: 'agent_end', messages: [] } satisfies PiAgentEvent, turn)[0],
      ).toMatchObject({ type: 'agent_end', stopReason: localReason })
    }
  })
})
