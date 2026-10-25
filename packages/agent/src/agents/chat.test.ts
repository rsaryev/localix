import { describe, expect, test } from 'bun:test'
import {
  toModelMessages,
  applyTurnSnapshot,
  createBrowserCacheSnapshot,
  markForkCacheAnchor,
  markHistoryCacheAnchor,
  type AgentChatMessage,
} from './chat'
import type { ChatMessage } from '../chat'
import type { TurnSnapshot } from './chat'
import type { ChatCacheDiagnosticsPayload, ChatDataPart } from '../chat-stream-types'
import { normalizeToolCallHistory } from './history-normalizer'

describe('createBrowserCacheSnapshot', () => {
  test('forwards params and always asserts a system cache boundary (browser path)', () => {
    const snap = createBrowserCacheSnapshot({
      providerId: 'p1',
      modelId: 'm1',
      systemPrompt: 'SP',
      dynamicSuffix: 'D',
      providerOptions: {},
      toolNames: ['read', 'write'],
      messageCount: 3,
    })
    expect(snap.modelId).toBe('m1')
    expect(snap.providerId).toBe('p1')
    expect(snap.messageCount).toBe(3)
    // The UI cache diagnostic always treats the system prompt as cache-boundaried.
    expect(snap.hasSystemCacheBoundary).toBe(true)
  })

  test('preserves content interleaving and opaque same-origin signatures', () => {
    const msg: ChatMessage = {
      id: 'a-signed',
      role: 'assistant',
      items: [
        {
          id: 't0',
          type: 'text',
          status: 'completed',
          turnIndex: 0,
          contentIndex: 0,
          text: 'A',
          textSignature: 'text-sig',
          api: 'google-generative-ai',
          provider: 'google',
          model: 'gemini-3',
        },
        {
          id: 'c0',
          type: 'tool_call',
          status: 'completed',
          turnIndex: 0,
          contentIndex: 1,
          toolCallId: 'c0',
          name: 'read',
          input: { path: 'a' },
          resultText: 'ok',
          thoughtSignature: 'tool-sig',
          api: 'google-generative-ai',
          provider: 'google',
          model: 'gemini-3',
          output: undefined,
          activeVerb: 'Reading',
        },
        {
          id: 'r0',
          type: 'reasoning',
          status: 'completed',
          turnIndex: 0,
          contentIndex: 2,
          text: '',
          thinkingSignature: 'thinking-sig',
          api: 'google-generative-ai',
          provider: 'google',
          model: 'gemini-3',
        },
        {
          id: 't1',
          type: 'text',
          status: 'completed',
          turnIndex: 0,
          contentIndex: 3,
          text: 'B',
          api: 'google-generative-ai',
          provider: 'google',
          model: 'gemini-3',
        },
      ],
    }
    const [assistant] = toModelMessages([msg]) as unknown as Array<Record<string, unknown>>
    expect(assistant).toMatchObject({
      role: 'assistant',
      api: 'google-generative-ai',
      provider: 'google',
      model: 'gemini-3',
    })
    expect(assistant.content).toEqual([
      { type: 'text', text: 'A', textSignature: 'text-sig' },
      {
        type: 'tool_call',
        id: 'c0',
        name: 'read',
        arguments: { path: 'a' },
        thoughtSignature: 'tool-sig',
      },
      { type: 'thinking', thinking: '', thinkingSignature: 'thinking-sig', redacted: undefined },
      { type: 'text', text: 'B', textSignature: undefined },
    ])
    expect('providerThinkingLevel' in assistant).toBe(false)
  })

  test('replays the level a provider bound signed reasoning to, per turn', () => {
    // Anthropic's managed-effort models reject (or, under drop_block, silently discard) signed
    // thinking replayed without the effort it was generated at.
    const origin = { api: 'anthropic-messages', provider: 'openrouter', model: 'haiku' }
    const msg: ChatMessage = {
      id: 'a-levels',
      role: 'assistant',
      items: [
        {
          id: 'r0',
          type: 'reasoning',
          status: 'completed',
          turnIndex: 0,
          text: 'x',
          thinkingSignature: 's0',
          ...origin,
          providerThinkingLevel: 'low',
        },
        {
          id: 't0',
          type: 'text',
          status: 'completed',
          turnIndex: 0,
          text: 'A',
          ...origin,
          providerThinkingLevel: 'low',
        },
        {
          id: 'r1',
          type: 'reasoning',
          status: 'completed',
          turnIndex: 1,
          text: 'y',
          thinkingSignature: 's1',
          ...origin,
          providerThinkingLevel: 'high',
        },
        {
          id: 't1',
          type: 'text',
          status: 'completed',
          turnIndex: 1,
          text: 'B',
          ...origin,
          providerThinkingLevel: 'high',
        },
      ],
    }
    const levels = toModelMessages([msg]).map(
      (message) => (message as { providerThinkingLevel?: string }).providerThinkingLevel,
    )
    expect(levels).toEqual(['low', 'high'])
  })

  test('the same inputs hash deterministically (replay-stable cache diagnostics)', () => {
    const params = {
      modelId: 'm',
      systemPrompt: 'SP',
      dynamicSuffix: 'D',
      providerOptions: {},
      toolNames: ['a'],
      messageCount: 1,
    }
    expect(createBrowserCacheSnapshot(params).systemPromptHash).toBe(
      createBrowserCacheSnapshot(params).systemPromptHash,
    )
  })
})

describe('applyTurnSnapshot', () => {
  const snap = (over: Partial<TurnSnapshot> = {}): TurnSnapshot =>
    ({ text: '', reasoning: '', tools: [], dataParts: [], ...over }) as TurnSnapshot

  test('takes content/reasoning/usage/status from the snapshot', () => {
    const out = applyTurnSnapshot(
      undefined,
      snap({
        text: 'hi',
        reasoning: 'because',
        status: { scope: 'agent', phase: 'running', message: 'x' } as TurnSnapshot['status'],
        usage: { totalTokens: 5 } as TurnSnapshot['usage'],
      }),
    )
    expect(out.content).toBe('hi')
    expect(out.reasoning).toBe('because')
    expect(out.usage).toEqual({ totalTokens: 5 } as TurnSnapshot['usage'])
    expect(out.status).toEqual({
      scope: 'agent',
      phase: 'running',
      message: 'x',
    } as TurnSnapshot['status'])
    expect(out.cacheDiagnostics).toBeUndefined()
  })

  test('empty snapshot text falls back to the prior message content, then to ""', () => {
    const prior = { content: 'prev' } as AgentChatMessage
    expect(applyTurnSnapshot(prior, snap({ text: '' })).content).toBe('prev')
    expect(applyTurnSnapshot(undefined, snap({ text: '' })).content).toBe('')
  })

  test('empty reasoning becomes undefined (not "")', () => {
    expect(applyTurnSnapshot(undefined, snap({ reasoning: '' })).reasoning).toBeUndefined()
  })

  test('without cacheDiagnostics, dataParts pass through unchanged', () => {
    const parts = [{ type: 'data-status' } as unknown as ChatDataPart]
    expect(applyTurnSnapshot(undefined, snap({ dataParts: parts })).dataParts).toBe(parts)
  })

  test('with cacheDiagnostics, a diagnostics part is prepended and the payload is attached', () => {
    const parts = [{ type: 'data-status' } as unknown as ChatDataPart]
    const diag = { snapshot: { modelId: 'm' } } as unknown as ChatCacheDiagnosticsPayload
    const out = applyTurnSnapshot(undefined, snap({ dataParts: parts }), diag)
    expect(out.dataParts).toHaveLength(2)
    expect(out.dataParts?.[1]).toBe(parts[0]) // original parts kept after the prepended diagnostics part
    expect(out.cacheDiagnostics).toBe(diag)
  })
})

describe('toModelMessages user attachments', () => {
  test('plain user message without attachments stays a string', () => {
    const wire = toModelMessages([{ id: 'u1', role: 'user', content: 'hello' }])
    const userMsg = wire.find((m) => m.role === 'user') as { content: unknown }
    expect(userMsg.content).toBe('hello')
  })

  test('image + text attachments become a content-part array', () => {
    const msg: ChatMessage = {
      id: 'u2',
      role: 'user',
      content: 'what is this',
      bindings: [
        { kind: 'image', mediaType: 'image/png', data: 'QUJD', name: 'a.png', size: 3 },
        { kind: 'text', name: 'notes.txt', text: 'line1', size: 5 },
      ],
    }
    const wire = toModelMessages([msg])
    const userMsg = wire.find((m) => m.role === 'user') as unknown as { content: unknown }
    expect(Array.isArray(userMsg.content)).toBe(true)
    const parts = userMsg.content as Array<Record<string, unknown>>
    expect(parts[0]).toEqual({ type: 'text', text: 'what is this' })
    expect(parts[1]).toEqual({ type: 'image', mediaType: 'image/png', data: 'QUJD' })
    expect(parts[2].type).toBe('text')
    expect(parts[2].text).toContain('notes.txt')
    expect(parts[2].text).toContain('line1')
  })

  test('spilled text attachment is emitted raw (manifest), not re-fenced', () => {
    const manifest =
      'Attached file saved to the workspace: .localix/attachments/s/m/data.csv (csv, 1.2 KB, 3000 lines).'
    const msg: ChatMessage = {
      id: 'u2b',
      role: 'user',
      content: 'see file',
      bindings: [
        {
          kind: 'text',
          name: 'data.csv',
          text: manifest,
          size: 12,
          spilled: true,
          path: '.localix/attachments/s/m/data.csv',
          lineCount: 3000,
        },
      ],
    }
    const wire = toModelMessages([msg])
    const userMsg = wire.find((m) => m.role === 'user') as unknown as {
      content: Array<Record<string, unknown>>
    }
    // Raw manifest, NOT wrapped in "Attached file: name\n\n```...```"
    expect(userMsg.content[1]).toEqual({ type: 'text', text: manifest })
  })

  test('contextRef text attachment (quiet @-link expansion) is emitted raw, not re-fenced', () => {
    const block = '--- @file:a.ts ---\n```ts\nconst a = 1\n```'
    const msg: ChatMessage = {
      id: 'u2c',
      role: 'user',
      content: 'look at @file:a.ts',
      bindings: [
        { kind: 'text', name: '@file:a.ts', text: block, size: block.length, contextRef: true },
      ],
    }
    const wire = toModelMessages([msg])
    const userMsg = wire.find((m) => m.role === 'user') as unknown as {
      content: Array<Record<string, unknown>>
    }
    // The original prompt text rides untouched; the expansion block is emitted raw.
    expect(userMsg.content[0]).toEqual({ type: 'text', text: 'look at @file:a.ts' })
    expect(userMsg.content[1]).toEqual({ type: 'text', text: block })
  })

  test('pdf attachment becomes a file content part', () => {
    const msg: ChatMessage = {
      id: 'u3',
      role: 'user',
      bindings: [
        { kind: 'file', mediaType: 'application/pdf', data: 'JVBER', name: 'doc.pdf', size: 6 },
      ],
    }
    const wire = toModelMessages([msg])
    const userMsg = wire.find((m) => m.role === 'user') as unknown as {
      content: Array<Record<string, unknown>>
    }
    expect(userMsg.content[0]).toEqual({
      type: 'file',
      mediaType: 'application/pdf',
      data: 'JVBER',
      filename: 'doc.pdf',
    })
  })

  test('attachment-only message (no text) is not dropped', () => {
    const msg: ChatMessage = {
      id: 'u4',
      role: 'user',
      bindings: [{ kind: 'image', mediaType: 'image/png', data: 'QUJD', name: 'a.png', size: 3 }],
    }
    const wire = toModelMessages([msg])
    expect(wire.some((m) => m.role === 'user')).toBe(true)
  })

  test('file-backed attachment with no inline data is announced, never emitted empty', () => {
    // Rehydration is the host's job and this SDK never reads `mediaId`, so an empty
    // image/file part must not go on the wire. It used to be DROPPED instead — but in the
    // real pipeline these bytes only go missing when something failed: with a cwd the host
    // rehydrates wire-carriable images and turns everything else into a spilled text
    // manifest, so a bytes-less `file` reaching here means neither happened. Dropping it
    // left the model unable to see the file AND unable to say so.
    const msg: ChatMessage = {
      id: 'u5',
      role: 'user',
      content: 'what is this',
      bindings: [
        { kind: 'image', mediaType: 'image/png', mediaId: 'abc123', name: 'a.png', size: 3 },
        { kind: 'file', mediaType: 'application/pdf', mediaId: 'def456', name: 'doc.pdf', size: 6 },
      ],
    }
    const wire = toModelMessages([msg])
    const userMsg = wire.find((m) => m.role === 'user') as unknown as { content: unknown }
    const parts = userMsg.content as Array<Record<string, unknown>>
    expect(parts[0]).toEqual({ type: 'text', text: 'what is this' })
    // No part carries undefined data …
    expect(parts.some((p) => p.type === 'image' || p.type === 'file')).toBe(false)
    // … and each lost attachment is named so the model can report it.
    expect(parts).toHaveLength(3)
    expect(parts[1].text).toContain('a.png')
    expect(parts[2].text).toContain('doc.pdf')
  })

  test('path attachment names its path when the host manifest did not run', () => {
    const msg: ChatMessage = {
      id: 'u5b',
      role: 'user',
      content: 'what is this',
      bindings: [
        {
          kind: 'path',
          path: '/Users/me/Downloads/report.txt',
          mediaType: 'text/plain',
          name: 'report.txt',
          size: 100,
        },
      ],
    }
    const wire = toModelMessages([msg])
    const userMsg = wire.find((m) => m.role === 'user') as unknown as { content: unknown }
    const parts = userMsg.content as Array<Record<string, unknown>>
    // The host owns the manifest, and this SDK still never reads the file. But if the
    // manifest step did not run, the PATH is the one thing worth saying: the model has file
    // tools, so naming it makes the attachment usable instead of merely lost.
    expect(parts).toHaveLength(2)
    expect(parts[1].text).toContain('/Users/me/Downloads/report.txt')
  })

  test('rehydrated attachment (mediaId + data) still emits an image part', () => {
    const msg: ChatMessage = {
      id: 'u6',
      role: 'user',
      bindings: [
        {
          kind: 'image',
          mediaType: 'image/png',
          mediaId: 'abc',
          data: 'QUJD',
          name: 'a.png',
          size: 3,
        },
      ],
    }
    const wire = toModelMessages([msg])
    const userMsg = wire.find((m) => m.role === 'user') as unknown as {
      content: Array<Record<string, unknown>>
    }
    expect(userMsg.content[0]).toEqual({ type: 'image', mediaType: 'image/png', data: 'QUJD' })
  })
})

describe('toModelMessages — item model', () => {
  test('rebuilds wire from items grouped by turnIndex (think→call→result order)', () => {
    const msg: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      items: [
        { id: 'r0', type: 'reasoning', status: 'completed', turnIndex: 0, text: 'hidden CoT' },
        { id: 't0', type: 'text', status: 'completed', turnIndex: 0, text: 'Let me read it.' },
        {
          id: 'c0',
          type: 'command',
          status: 'completed',
          turnIndex: 0,
          toolCallId: 'c0',
          name: 'bash',
          input: { command: 'ls' },
          command: 'ls',
          resultText: 'file1\nfile2',
          exitCode: 0,
        },
        { id: 't1', type: 'text', status: 'completed', turnIndex: 1, text: 'Done.' },
      ],
    }
    const wire = toModelMessages([msg])
    // turn 0: assistant(text+tool_call) then tool(result); turn 1: assistant(text)
    expect(wire.map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant'])
    const a0 = wire[0] as unknown as { content: Array<Record<string, unknown>> }
    expect(a0.content.find((c) => c.type === 'text')).toMatchObject({ text: 'Let me read it.' })
    expect(a0.content.find((c) => c.type === 'tool_call')).toMatchObject({
      id: 'c0',
      name: 'bash',
      arguments: { command: 'ls' },
    })
    // reasoning is NOT re-sent
    expect(a0.content.some((c) => c.type === 'text' && c.text === 'hidden CoT')).toBe(false)
    const tool = wire[1] as unknown as { results: Array<Record<string, unknown>> }
    expect(tool.results[0]).toMatchObject({
      toolCallId: 'c0',
      toolName: 'bash',
      content: 'file1\nfile2',
      isError: false,
    })
  })

  test('failed tool item carries isError and error text', () => {
    const msg: ChatMessage = {
      id: 'a2',
      role: 'assistant',
      items: [
        {
          id: 'x',
          type: 'tool_call',
          status: 'failed',
          toolCallId: 'x',
          name: 'read',
          activeVerb: 'Reading',
          input: { path: '/nope' },
          errorText: 'ENOENT',
        },
      ],
    }
    const wire = toModelMessages([msg])
    const tool = wire.find((m) => m.role === 'tool') as unknown as {
      results: Array<Record<string, unknown>>
    }
    expect(tool.results[0]).toMatchObject({ toolCallId: 'x', isError: true, content: 'ENOENT' })
  })

  test('text-only items message produces a single assistant message, no tool message', () => {
    const msg: ChatMessage = {
      id: 'a3',
      role: 'assistant',
      items: [{ id: 't', type: 'text', status: 'completed', text: 'from items' }],
    }
    const wire = toModelMessages([msg])
    const a = wire[0] as unknown as { content: Array<Record<string, unknown>> }
    expect(a.content[0]).toMatchObject({ type: 'text', text: 'from items' })
    expect(wire.some((m) => m.role === 'tool')).toBe(false)
  })

  test("a tool item's supersedeKey survives rehydrate onto the wire tool_result (cross-turn collapse)", () => {
    const msg: ChatMessage = {
      id: 'a4',
      role: 'assistant',
      items: [
        {
          id: 'p',
          type: 'tool_call',
          status: 'completed',
          toolCallId: 'p',
          name: 'browser',
          activeVerb: 'Controlling browser',
          input: { action: 'snapshot' },
          resultText: 'Page …',
          supersedeKey: 'browser',
        },
      ],
    }
    const wire = toModelMessages([msg])
    const tool = wire.find((m) => m.role === 'tool') as unknown as {
      results: Array<Record<string, unknown>>
    }
    expect(tool.results[0]).toMatchObject({ toolCallId: 'p', supersedeKey: 'browser' })
  })
})

describe('markHistoryCacheAnchor', () => {
  const user = (text: string) => ({ role: 'user' as const, content: text, timestamp: 0 })
  const assistant = () => ({ role: 'assistant' as const, model: 'm', content: [], timestamp: 0 })

  test('anchors the second-to-last message (the trigger carries the volatile tail)', () => {
    const msgs = [user('task'), assistant(), user('wake + runtime tail')]
    const out = markHistoryCacheAnchor(msgs as never[]) as Array<{ cacheAnchor?: boolean }>
    expect(out[0].cacheAnchor).toBeUndefined()
    expect(out[1].cacheAnchor).toBe(true)
    expect(out[2].cacheAnchor).toBeUndefined()
  })

  test('idempotent: re-marking a grown history moves the anchor, never duplicates it', () => {
    const msgs = [user('task'), assistant(), user('wake')]
    markHistoryCacheAnchor(msgs as never[])
    const grown = [...msgs, assistant(), user('wake 2')]
    const out = markHistoryCacheAnchor(grown as never[]) as Array<{ cacheAnchor?: boolean }>
    expect(out.filter((m) => m.cacheAnchor)).toHaveLength(1)
    expect(out[3].cacheAnchor).toBe(true)
  })

  test('short histories are a no-op', () => {
    const single = [user('only')]
    const out = markHistoryCacheAnchor(single as never[]) as Array<{ cacheAnchor?: boolean }>
    expect(out[0].cacheAnchor).toBeUndefined()
    expect(markHistoryCacheAnchor([] as never[])).toEqual([])
  })

  test('skips a droppable errored/aborted assistant so the anchor lands on a surviving message', () => {
    // transformMessages drops assistant turns with stopReason error/aborted; anchoring
    // one would place no breakpoint and re-write the whole history to cache that run.
    const errored = {
      role: 'assistant' as const,
      model: 'm',
      content: [],
      timestamp: 0,
      stopReason: 'error' as const,
    }
    const msgs = [user('task'), user('stable prior'), errored, user('trigger')]
    const out = markHistoryCacheAnchor(msgs as never[]) as Array<{
      cacheAnchor?: boolean
      stopReason?: string
    }>
    // len-2 is the errored assistant → skipped; the anchor walks back to 'stable prior'.
    expect(out[2].cacheAnchor).toBeUndefined()
    expect(out[1].cacheAnchor).toBe(true)
    expect(out.filter((m) => m.cacheAnchor)).toHaveLength(1)
  })
})

describe('toModelMessages never rewrites an earlier snapshot', () => {
  test('a newer same-key snapshot leaves the older ones exactly as they were sent', () => {
    // Collapsing stale frames here rewrote an already-sent message on the turn the next frame
    // arrived — a prefix-cache miss and, on preserved-thinking models, every later thinking
    // block dropped. The collapse happens at a context checkpoint instead.
    const snapshot = (id: string, body: string): ChatMessage => ({
      id,
      role: 'assistant',
      items: [
        {
          id,
          type: 'tool_call',
          status: 'completed',
          toolCallId: id,
          name: 'terminal',
          activeVerb: 'Reading terminal',
          input: { action: 'read' },
          resultText: body,
          supersedeKey: 'terminal:t1',
        },
      ],
    })
    const wire = toModelMessages([
      snapshot('s1', 'FRAME-ONE '.repeat(40)),
      snapshot('s2', 'FRAME-TWO '.repeat(40)),
      snapshot('s3', 'FRAME-THREE '.repeat(40)),
    ])
    const results = wire.flatMap((m) => (m.role === 'tool' ? m.results : []))
    expect(results.map((r) => r.content)).toEqual([
      'FRAME-ONE '.repeat(40),
      'FRAME-TWO '.repeat(40),
      'FRAME-THREE '.repeat(40),
    ])
    // Keys and ids survive onto the wire, for the checkpoint that will collapse them.
    expect(results.every((r) => r.supersedeKey === 'terminal:t1')).toBe(true)
  })
})

/**
 * A tool whose item is still `running` must reach the model as a RESULT, not as an unpaired call.
 *
 * Async delegates and background jobs are deliberately left `running` — their real result lands later
 * through the child/job resolution. Emitting nothing for them left the assistant's tool call
 * unpaired, and `normalizeToolCallHistory` (which lives in a DB-less package and cannot know better)
 * repairs such a pair the only way it can: `{content: 'aborted', isError: true}`.
 *
 * Measured before this: a sub-agent that was alive and working was replayed to the model as an
 * ERRORED, ABORTED call — while the delegate tool's own live result says "do NOT poll, sleep-wait, or
 * re-delegate this task". The wire silently reversed the instruction the tool spent a sentence on.
 */
describe('toModelMessages — a still-running tool call', () => {
  const withStatus = (status: string, over: Record<string, unknown> = {}): AgentChatMessage =>
    ({
      id: 'm1',
      role: 'assistant',
      content: '',
      items: [
        {
          id: 'i1',
          type: 'tool_call',
          status,
          turnIndex: 0,
          toolCallId: 'call_abc',
          name: 'agents',
          input: { prompt: 'audit auth' },
          resultText: 'Sub-agent started.',
          ...over,
        },
      ],
    }) as unknown as AgentChatMessage

  const resultOf = (message: AgentChatMessage) => {
    const wire = normalizeToolCallHistory(toModelMessages([message]) as never)
    const toolMessage = wire.find((m) => 'role' in m && m.role === 'tool') as
      | { results: Array<{ content: string; isError?: boolean; toolCallId: string }> }
      | undefined
    return toolMessage?.results?.[0]
  }

  test('is paired with its own ack — never with a synthesized "aborted"', () => {
    const result = resultOf(withStatus('running'))
    expect(result?.toolCallId).toBe('call_abc')
    expect(result?.content).toContain('Sub-agent started.')
    // The regression, stated: the child is alive, so the model must not be told it aborted.
    expect(result?.content).not.toBe('aborted')
    expect(result?.isError).toBe(false)
  })

  test('says it is still running, so the absent outcome is not read as a finished one', () => {
    const result = resultOf(withStatus('running'))
    expect(result?.content).toContain('still running')
    // …and tells the model not to re-issue, which is the whole reason this matters: the tool's own
    // "do NOT re-delegate" wording lives in a result that the rebuild used to throw away.
    expect(result?.content).toContain('do not re-issue')
  })

  test('a running item with no ack still produces a paired, non-error result', () => {
    const result = resultOf(withStatus('running', { resultText: undefined }))
    expect(result?.content).toContain('still running')
    expect(result?.content).not.toContain('aborted')
    expect(result?.isError).toBe(false)
  })

  test('a COMPLETED item is untouched — no note, no extra tokens', () => {
    const result = resultOf(withStatus('completed'))
    expect(result?.content).toBe('Sub-agent started.')
    expect(result?.isError).toBe(false)
  })

  test('a FAILED item stays an error', () => {
    // resultText cleared so errorText is what remains — resultContent prefers resultText, which is
    // existing precedence, not something this change touches.
    const result = resultOf(withStatus('failed', { resultText: undefined, errorText: 'boom' }))
    expect(result?.isError).toBe(true)
    expect(result?.content).toContain('boom')
  })

  test('a PENDING item keeps the synthesized abort — it never executed', () => {
    // Deliberate asymmetry: "aborted" is a fair description of a call that never ran, and widening
    // the change to `pending` would claim work had started when none had.
    const result = resultOf(withStatus('pending'))
    expect(result?.content).toBe('aborted')
    expect(result?.isError).toBe(true)
  })

  test('exactly ONE result per call, so the provider pairing stays valid', () => {
    const wire = normalizeToolCallHistory(toModelMessages([withStatus('running')]) as never)
    const results = wire.flatMap((m) =>
      'role' in m && m.role === 'tool' ? (m as { results: unknown[] }).results : [],
    )
    expect(results).toHaveLength(1)
  })
})

/**
 * An attachment must never leave the wire SILENTLY.
 *
 * These parts used to be dropped when their bytes were absent. The user still sees the file
 * attached in their own message, so the model answered as though nothing had been attached —
 * and could not say otherwise, because nothing told it a file was meant to be there. A
 * failure the model can report beats one it cannot see: the part becomes text that states the
 * problem and says to inform the user.
 */
describe('attachments that cannot be carried are announced, never dropped', () => {
  const userParts = (msg: ChatMessage) => {
    const wire = toModelMessages([msg]) as unknown as Array<{ role: string; content: unknown }>
    const user = wire.find((m) => m.role === 'user')!
    return user.content as Array<Record<string, unknown>>
  }

  test('an image whose bytes were never rehydrated becomes a reportable text part', () => {
    const parts = userParts({
      id: 'u-img',
      role: 'user',
      content: 'what is this',
      // `mediaId` without `data`: the host owns rehydration and it did not run.
      bindings: [{ kind: 'image', mediaType: 'image/png', mediaId: 'stored-1', name: 'a.png' }],
    } as ChatMessage)

    expect(parts).toHaveLength(2)
    expect(parts[1].type).toBe('text')
    expect(parts[1].text).toContain('a.png')
    expect(parts[1].text).toContain('Tell the user')
  })

  test('a file/audio/video without bytes is announced too', () => {
    const parts = userParts({
      id: 'u-file',
      role: 'user',
      content: 'listen',
      bindings: [{ kind: 'audio', mediaType: 'audio/mpeg', mediaId: 'stored-2', name: 'clip.mp3' }],
    } as ChatMessage)

    expect(parts[1].type).toBe('text')
    expect(parts[1].text).toContain('clip.mp3')
  })

  test('it names the media type when the attachment has no filename', () => {
    const parts = userParts({
      id: 'u-noname',
      role: 'user',
      content: 'x',
      bindings: [{ kind: 'file', mediaType: 'application/zip', mediaId: 'stored-3' }],
    } as ChatMessage)

    expect(parts[1].text).toContain('application/zip')
  })

  test('a path the host failed to materialize is handed over as a path, not lost', () => {
    // The host normally replaces this with a spilled-text manifest. If that did not run, the
    // model still has file tools — so the path alone makes the attachment usable rather than
    // merely reported.
    const parts = userParts({
      id: 'u-path',
      role: 'user',
      content: 'review it',
      bindings: [
        {
          kind: 'path',
          path: '/Users/me/proj/report.pdf',
          mediaType: 'application/pdf',
          name: 'report.pdf',
          size: 10,
        },
      ],
    } as ChatMessage)

    expect(parts[1].type).toBe('text')
    expect(parts[1].text).toContain('/Users/me/proj/report.pdf')
    expect(parts[1].text).toContain('Read it')
  })

  test('a carriable image is still sent as real image bytes', () => {
    // Control: the announcement path must not have swallowed the normal one.
    const parts = userParts({
      id: 'u-ok',
      role: 'user',
      content: 'ok',
      bindings: [{ kind: 'image', mediaType: 'image/png', data: 'QUJD', name: 'a.png', size: 3 }],
    } as ChatMessage)

    expect(parts[1]).toEqual({ type: 'image', mediaType: 'image/png', data: 'QUJD' })
  })
})

describe('images a tool returned, on later turns', () => {
  const shot = (id: string, data?: string): ChatMessage =>
    ({
      id,
      role: 'assistant',
      items: [
        {
          id,
          type: 'tool_call',
          status: 'completed',
          toolCallId: id,
          name: 'browser',
          activeVerb: 'Controlling browser',
          resultText: `Screenshot ${id} (4×4).`,
          supersedeKey: 'browser:screenshot',
          attachments: [
            {
              kind: 'image',
              mediaType: 'image/png',
              mediaId: `${id}.png`,
              data,
              name: 'i',
              size: 3,
            },
          ],
        },
      ],
    }) as ChatMessage
  const resultsOf = (messages: ChatMessage[]) =>
    toModelMessages(messages).flatMap((m) => (m.role === 'tool' ? m.results : []))

  test('the replayed result carries the picture beside its label', () => {
    // The defect: the replay was the string `[image]`, and the model said it saw no screenshot.
    expect(resultsOf([shot('s1', 'QUJD')])[0]!.content).toEqual([
      { type: 'text', text: 'Screenshot s1 (4×4).' },
      { type: 'image', mediaType: 'image/png', data: 'QUJD' },
    ])
  })

  test('an image this request may not carry is named, never silently dropped', () => {
    const content = resultsOf([shot('s1')])[0]!.content as Array<{ type: string; text?: string }>
    expect(content.map((part) => part.type)).toEqual(['text', 'text'])
    expect(content[1]!.text).toContain('not included in this request')
  })

  test('a newer screenshot does not change how an older one is replayed', () => {
    const [old, live] = resultsOf([shot('s1', 'T0xE'), shot('s2', 'TkVX')])
    expect(old!.content).toContainEqual({ type: 'image', mediaType: 'image/png', data: 'T0xE' })
    expect(live!.content).toContainEqual({ type: 'image', mediaType: 'image/png', data: 'TkVX' })
  })
})

describe('markForkCacheAnchor', () => {
  const user = (text: string) => ({ role: 'user' as const, content: text, timestamp: 0 })
  const call = (id: string) => ({
    role: 'assistant' as const,
    model: 'm',
    timestamp: 0,
    content: [{ type: 'tool_call' as const, id, name: 'delegate', arguments: {} }],
  })
  const tool = (id: string) => ({
    role: 'tool' as const,
    timestamp: 0,
    results: [
      { type: 'tool_result' as const, toolCallId: id, toolName: 'delegate', content: 'ok' },
    ],
  })
  const anchored = (msgs: unknown[]) =>
    (msgs as Array<{ cacheAnchor?: boolean }>).flatMap((m, i) => (m.cacheAnchor ? [i] : []))

  test('anchors the message before the step that made the call', () => {
    const msgs = [user('q'), user('context'), call('c1'), tool('c1'), user('directive')]
    expect(anchored(markForkCacheAnchor(msgs as never[], 'c1'))).toEqual([1])
  })

  test('moves a stale anchor instead of adding a second one', () => {
    const msgs = [user('q'), user('context'), call('c1'), tool('c1'), user('directive')]
    markHistoryCacheAnchor(msgs as never[])
    expect(anchored(markForkCacheAnchor(msgs as never[], 'c1'))).toEqual([1])
  })

  test('without the call in the wire the ordinary anchor applies', () => {
    const msgs = [user('q'), call('other'), tool('other'), user('directive')]
    expect(anchored(markForkCacheAnchor(msgs as never[], 'c1'))).toEqual([2])
  })
})
