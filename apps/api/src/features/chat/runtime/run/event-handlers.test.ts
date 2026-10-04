import { DEFAULT_AGENT_PARTICIPANT } from '../../../../db'
import { describe, expect, test } from 'bun:test'
import type { AssistantMessage } from '@localixai/agent'
import { toModelMessages } from '@localixai/agent/agents/chat'

import {
  applyAssistantDelta,
  captureCompletedTurnCheckpoint,
  scanAssistantContent,
} from './event-handlers'
import { createRunTurnState } from './turn-state'
import { emptyAssistantPayload } from '../message-envelope'
import { emptySessionTiming } from '../../session-timing'
import { buildToolItem } from '../items'
import { createItemAccumulator } from '../items'

describe('scanAssistantContent', () => {
  test('retains provider part boundaries, order, and signatures', () => {
    const message: AssistantMessage = {
      role: 'assistant',
      api: 'google-generative-ai',
      provider: 'google',
      model: 'gemini-3',
      timestamp: 1,
      content: [
        { type: 'text', text: 'A', textSignature: 'text-sig' },
        { type: 'tool_call', id: 'c1', name: 'read', arguments: {}, thoughtSignature: 'tool-sig' },
        { type: 'text', text: 'B' },
      ],
    }

    expect(scanAssistantContent(message)).toMatchObject({
      text: 'AB',
      toolCalls: [{ id: 'c1', thoughtSignature: 'tool-sig' }],
      parts: [
        { type: 'text', contentIndex: 0, text: 'A', textSignature: 'text-sig' },
        { type: 'tool', contentIndex: 1, call: { id: 'c1', thoughtSignature: 'tool-sig' } },
        { type: 'text', contentIndex: 2, text: 'B' },
      ],
    })
  })
})

describe('applyAssistantDelta', () => {
  const origin = { api: 'openai-responses', provider: 'openai', model: 'gpt-test' }

  test('folds cumulative output from fixed-size delta frames without a message rescan contract', () => {
    const state = createRunTurnState({
      payload: emptyAssistantPayload('a1', DEFAULT_AGENT_PARTICIPANT),
      assistantCreatedAt: '2026-07-22T00:00:00.000Z',
      baseSessionTiming: emptySessionTiming(),
    })
    const acc = createItemAccumulator(() => 'Running')
    const chunkCount = 4_096

    for (let index = 0; index < chunkCount; index++) {
      applyAssistantDelta(
        { state, acc },
        {
          kind: 'text',
          phase: 'delta',
          contentIndex: 0,
          delta: 'x',
          origin,
        },
      )
    }

    expect(state.currentTurnText.length).toBe(chunkCount)
    expect(state.payload.content).toBe('x'.repeat(chunkCount))
    expect(acc.list()).toMatchObject([{ id: 'text-0', text: 'x'.repeat(chunkCount) }])
  })

  test('preserves progressive tool calls and provider metadata one part at a time', () => {
    const state = createRunTurnState({
      payload: emptyAssistantPayload('a1', DEFAULT_AGENT_PARTICIPANT),
      assistantCreatedAt: '2026-07-22T00:00:00.000Z',
      baseSessionTiming: emptySessionTiming(),
    })
    const acc = createItemAccumulator(() => 'Running')

    applyAssistantDelta(
      { state, acc },
      {
        kind: 'reasoning',
        phase: 'delta',
        contentIndex: 0,
        delta: 'think',
        origin,
        thinkingSignature: 'reason-sig',
      },
    )
    applyAssistantDelta(
      { state, acc },
      {
        kind: 'tool_call',
        phase: 'delta',
        contentIndex: 1,
        delta: '"src/a.ts"',
        id: 'call-1',
        name: 'read',
        input: { path: 'src/a.ts' },
        origin,
        thoughtSignature: 'tool-sig',
      },
    )

    expect(state.payload.reasoning).toBe('think')
    expect(state.payload.items).toMatchObject([
      {
        type: 'reasoning',
        text: 'think',
        thinkingSignature: 'reason-sig',
        model: 'gpt-test',
      },
      {
        status: 'pending',
        toolCallId: 'call-1',
        input: { path: 'src/a.ts' },
        thoughtSignature: 'tool-sig',
        model: 'gpt-test',
      },
    ])
  })

  test('keeps earlier public text when an conversation_control follow-up turn emits whitespace', () => {
    const state = createRunTurnState({
      payload: emptyAssistantPayload('a1', DEFAULT_AGENT_PARTICIPANT),
      assistantCreatedAt: '2026-07-22T00:00:00.000Z',
      baseSessionTiming: emptySessionTiming(),
    })
    const acc = createItemAccumulator(() => 'Running')

    state.currentTurnIndex = 0
    applyAssistantDelta(
      { state, acc },
      {
        kind: 'text',
        phase: 'delta',
        contentIndex: 0,
        delta: 'Is it a deliberate choice?',
        origin,
      },
    )
    state.currentTurnIndex = 1
    state.currentTurnText = ''
    applyAssistantDelta(
      { state, acc },
      {
        kind: 'text',
        phase: 'delta',
        contentIndex: 0,
        delta: '\n\n',
        origin,
      },
    )

    expect(state.payload.content).toBe('Is it a deliberate choice?')
    expect(acc.list()).toMatchObject([
      { id: 'text-0', text: 'Is it a deliberate choice?' },
      { id: 'text-1', text: '\n\n' },
    ])
  })
})

describe('captureCompletedTurnCheckpoint', () => {
  const turn = (stopReason: 'tool_use' | 'error', toolResults: unknown[] = []) =>
    ({
      type: 'turn_end',
      turnIndex: 0,
      message: {
        role: 'assistant',
        content: [],
        model: 'm',
        timestamp: 1,
        stopReason,
      },
      toolResults,
    }) as never

  test('captures the payload only after a successful, fully-settled turn', () => {
    const state = createRunTurnState({
      payload: emptyAssistantPayload('a1', DEFAULT_AGENT_PARTICIPANT),
      assistantCreatedAt: '2026-07-22T00:00:00.000Z',
      baseSessionTiming: emptySessionTiming(),
    })
    state.currentPayload = {
      ...state.currentPayload,
      items: [
        buildToolItem({
          toolCallId: 'tool-1',
          name: 'read',
          input: { path: 'src/a.ts' },
          status: 'completed',
          resultText: 'file contents',
          activeVerb: 'Reading',
          turnIndex: 0,
        }),
      ],
    }
    state.timing.toolMs = 42

    captureCompletedTurnCheckpoint({ state }, turn('tool_use', [{ toolCallId: 'tool-1' }]))

    expect(state.completedTurnCheckpoint?.payload.items?.[0]).toMatchObject({
      toolCallId: 'tool-1',
      status: 'completed',
    })
    expect(state.completedTurnCheckpoint?.payload.timing?.toolMs).toBe(42)
    expect(state.completedToolTurnIndex).toBe(0)
    const wire = toModelMessages([state.completedTurnCheckpoint!.payload])
    expect(wire.map((message) => message.role)).toEqual(['assistant', 'tool'])
    expect(wire[1]).toMatchObject({
      results: [{ toolCallId: 'tool-1', content: 'file contents' }],
    })
  })

  test('an error turn cannot overwrite the last good checkpoint', () => {
    const state = createRunTurnState({
      payload: emptyAssistantPayload('a1', DEFAULT_AGENT_PARTICIPANT),
      assistantCreatedAt: '2026-07-22T00:00:00.000Z',
      baseSessionTiming: emptySessionTiming(),
    })
    state.currentPayload = { ...state.currentPayload, content: 'completed prefix' }
    captureCompletedTurnCheckpoint({ state }, turn('tool_use'))
    state.currentPayload = { ...state.currentPayload, content: 'partial failed request' }

    captureCompletedTurnCheckpoint({ state }, turn('error'))

    expect(state.completedTurnCheckpoint?.payload.content).toBe('completed prefix')
    expect(state.completedToolTurnIndex).toBeUndefined()
  })
})
