import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_MAX_BYTES,
  pruneWireMessages,
  textEncoderByteLength,
  type Message,
} from '@localixai/agent'

import { retrieveStoredOutput } from '../agent-core/tools/bash/retrieve-output'
import { createSecretExposureShield } from '../secrets/exposure-shield'
import type { ContextStore, ToolOutputArtifact } from './repository'
import { buildExternalizeAfterToolCall, EXTERNALIZE_THRESHOLD_BYTES } from './externalize'

const fakeStore = (sectionCount = 3, coverage: 'full' | 'prefix' = 'full') => {
  const indexed: Array<{ toolCallId: string; toolName: string; text: string }> = []
  const persisted: ToolOutputArtifact[] = []
  const store = {
    async putToolOutputArtifact(input: {
      toolCallId: string
      toolName: string
      text: string
      toolInput: unknown
      isError: boolean
    }) {
      persisted.push({
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        text: input.text,
        input: input.toolInput,
        isError: input.isError,
      })
    },
    async getToolOutputArtifact(_userId: string, _sessionId: string, toolCallId: string) {
      return persisted.find((artifact) => artifact.toolCallId === toolCallId) ?? null
    },
    async indexToolOutput(input: { toolCallId: string; toolName: string; text: string }) {
      indexed.push(input)
      return { sections: sectionCount, covered: coverage }
    },
    async hasChunks() {
      return false
    },
    async searchChunks() {
      return []
    },
  } as unknown as ContextStore
  return { store, indexed, persisted }
}

const ctx = (
  over: Partial<Parameters<ReturnType<typeof buildExternalizeAfterToolCall>>[0]> = {},
) => ({
  toolCallId: 'call_1',
  toolName: 'bash',
  input: {},
  result: { content: 'x'.repeat(EXTERNALIZE_THRESHOLD_BYTES + 1) },
  messages: [],
  ...over,
})

function modelFacingResult(content: string): string {
  const messages: Message[] = [
    { role: 'user', content: 'run it', timestamp: 0 },
    {
      role: 'assistant',
      content: [{ type: 'tool_call', id: 'call_1', name: 'bash', arguments: {} }],
      model: 'test',
      timestamp: 0,
    },
    {
      role: 'tool',
      results: [{ type: 'tool_result', toolCallId: 'call_1', toolName: 'bash', content }],
      timestamp: 0,
    },
  ]
  const bounded = pruneWireMessages(messages, {
    keepRecentTokens: 1_000_000,
    minKeepRecent: 10,
    pressureTokens: 1_000_000,
  })
  const result = (bounded[2] as Extract<Message, { role: 'tool' }>).results[0]
  if (typeof result.content !== 'string') throw new Error('expected text result')
  return result.content
}

describe('buildExternalizeAfterToolCall', () => {
  const opts = { userId: 'u1', sessionId: 's1', sanitizeInput: (value: unknown) => value }
  const signal = new AbortController().signal

  test('durably stores, indexes, and appends a search pointer', async () => {
    const { store, indexed, persisted } = fakeStore()
    const after = await buildExternalizeAfterToolCall(store, opts)(ctx(), signal)

    expect(persisted).toHaveLength(1)
    expect(indexed).toHaveLength(1)
    expect(after?.content).toContain(
      'tool_output(action="search", queries=[…], tool_call_id="call_1")',
    )
    expect(after?.content?.startsWith('x'.repeat(100))).toBe(true)
  })

  test('indexes for later but does not advertise disabled tool_output', async () => {
    const { store, indexed, persisted } = fakeStore()
    const after = await buildExternalizeAfterToolCall(store, {
      ...opts,
      toolOutputAvailable: false,
    })(ctx(), signal)

    expect(persisted).toHaveLength(1)
    expect(indexed).toHaveLength(1)
    expect(after).toBeUndefined()
  })

  test('stores and indexes the richer details.output copy', async () => {
    const { store, indexed, persisted } = fakeStore()
    const raw = 'r'.repeat(EXTERNALIZE_THRESHOLD_BYTES * 2)
    await buildExternalizeAfterToolCall(store, opts)(
      ctx({
        input: { command: 'test' },
        result: {
          content: 'x'.repeat(EXTERNALIZE_THRESHOLD_BYTES + 1),
          details: { output: raw },
        },
      }),
      signal,
    )

    expect(indexed[0].text).toBe(raw)
    expect(persisted[0]).toMatchObject({ text: raw, input: { command: 'test' } })
  })

  test('shields persisted input secrets while keeping safe heavy mutation arguments', async () => {
    const { store, persisted } = fakeStore()
    const shield = createSecretExposureShield()
    const secret = 'sk-artifact-secret-abcdef123456'
    shield.remember('u1', secret)
    const safeContent = 'export const answer = 42\n'
    const hook = buildExternalizeAfterToolCall(store, {
      ...opts,
      sanitizeInput: (value) => shield.redactValue('u1', value),
    })

    await hook(
      ctx({
        toolName: 'write',
        input: {
          path: 'src/answer.ts',
          content: `${safeContent}// credential=${secret}\n`,
        },
        result: { content: 'Wrote src/answer.ts' },
      }),
      signal,
    )

    const inputJson = JSON.stringify(persisted[0].input)
    expect(inputJson).not.toContain(secret)
    expect(inputJson).toContain('[vault-secret]')
    expect(inputJson).toContain(safeContent.trim())

    const recovered = await retrieveStoredOutput(
      { findActiveBranchToolCallMessage: async () => null },
      'u1',
      's1',
      'call_1',
      store,
    )
    expect(recovered.content).not.toContain(secret)
    expect(recovered.content).toContain('[vault-secret]')
    expect(recovered.content).toContain(safeContent.trim())
  })

  test('persists every result but excludes errors, snapshots, and recovery tools from FTS', async () => {
    const { store, indexed, persisted } = fakeStore()
    const hook = buildExternalizeAfterToolCall(store, opts)
    expect(await hook(ctx({ result: { content: 'small' } }), signal)).toBeUndefined()
    expect(
      await hook(ctx({ result: { content: 'x'.repeat(30_000), isError: true } }), signal),
    ).toBeUndefined()
    expect(
      await hook(ctx({ result: { content: 'x'.repeat(30_000), supersedeKey: 'preview' } }), signal),
    ).toBeUndefined()
    expect(await hook(ctx({ toolName: 'tool_output' }), signal)).toBeUndefined()
    expect(await hook(ctx({ toolName: 'tool_output' }), signal)).toBeUndefined()
    expect(indexed).toHaveLength(0)
    expect(persisted).toHaveLength(5)
  })

  test('says the coverage is a prefix when chunking dropped the output tail', async () => {
    const { store } = fakeStore(400, 'prefix')
    const after = await buildExternalizeAfterToolCall(store, opts)(
      ctx({ result: { content: `HEAD\n${'x'.repeat(DEFAULT_MAX_BYTES + 8_000)}\nTAIL` } }),
      signal,
    )
    // "400 sections ... are indexed" reads as full coverage to a model that cannot know 400
    // is the cap, so the pointer has to name the prefix and where the rest lives.
    expect(after?.content).toContain('the first 400 sections')
    expect(after?.content).toContain('its tail is not')
    expect(after?.content).toContain('tool_output action="get" has the whole text')
  })

  test('promises nothing about a tail when the whole output was indexed', async () => {
    const { store } = fakeStore(3, 'full')
    const after = await buildExternalizeAfterToolCall(store, opts)(
      ctx({ result: { content: `HEAD\n${'x'.repeat(DEFAULT_MAX_BYTES + 8_000)}\nTAIL` } }),
      signal,
    )
    expect(after?.content).toContain('3 sections of this')
    expect(after?.content).not.toContain('the first')
    expect(after?.content).not.toContain('its tail is not')
  })

  test('keeps exact recovery available when optional FTS indexing fails', async () => {
    const { store, persisted } = fakeStore()
    store.indexToolOutput = async () => {
      throw new Error('fts unavailable')
    }
    const original = `HEAD\n${'x'.repeat(DEFAULT_MAX_BYTES + 8_000)}\nTAIL`
    const after = await buildExternalizeAfterToolCall(store, opts)(
      ctx({ result: { content: original } }),
      signal,
    )

    expect(persisted[0].text).toBe(original)
    expect(after).toBeUndefined()
    const wire = modelFacingResult(original)
    expect(wire).toContain('tool_output(action="get", tool_call_id="call_1")')
    expect(wire).not.toContain('tool_output(action="search"')
    expect(textEncoderByteLength(wire)).toBeLessThanOrEqual(DEFAULT_MAX_BYTES)
  })

  test('does not expose a pointer until the exact artifact is committed', async () => {
    const { store, persisted } = fakeStore()
    let release!: () => void
    const durableGate = new Promise<void>((resolve) => {
      release = resolve
    })
    const basePut = store.putToolOutputArtifact.bind(store)
    store.putToolOutputArtifact = async (input) => {
      await durableGate
      await basePut(input)
    }

    const original = `HEAD\n${'界'.repeat(20_000)}\nTAIL_DIAGNOSTIC`
    let hookReturned = false
    const pending = buildExternalizeAfterToolCall(store, opts)(
      ctx({ result: { content: original } }),
      signal,
    ).then((result) => {
      hookReturned = true
      return result
    })
    await Promise.resolve()
    expect(hookReturned).toBe(false)
    expect(persisted).toHaveLength(0)

    release()
    const after = await pending
    expect(after?.content).toContain(
      'tool_output(action="search", queries=[…], tool_call_id="call_1")',
    )
    const wire = modelFacingResult(after?.content ?? '')
    expect(wire).toContain('tool_output(action="get", tool_call_id="call_1")')
    expect(wire).toContain('TAIL_DIAGNOSTIC')
    expect(textEncoderByteLength(wire)).toBeLessThanOrEqual(DEFAULT_MAX_BYTES)

    // The runtime-event consumer has not persisted agent_messages in this race.
    // Exact retrieval must already work from the independent artifact.
    const recovered = await retrieveStoredOutput(
      { findActiveBranchToolCallMessage: async () => null },
      'u1',
      's1',
      'call_1',
      store,
    )
    expect(recovered.isError).toBeFalsy()
    expect(recovered.content).toBe(original)
  })

  test('fails closed when the mandatory artifact write fails', async () => {
    const { store } = fakeStore()
    store.putToolOutputArtifact = async () => {
      throw new Error('disk full')
    }
    const hook = buildExternalizeAfterToolCall(store, opts)
    expect(hook(ctx(), signal)).rejects.toThrow('disk full')
  })
})
