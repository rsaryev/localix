import { describe, expect, test } from 'bun:test'
import type { LanguageModelRequest } from '@localixai/agent/runtime'
import { cleanGeneratedTitle, createTitleGenerator } from './title-generation'
import {
  buildInputIntentContext,
  renderInputIntentContext,
} from '../../context-fabric/input-intent'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function titleHarness(
  options: { configured?: boolean; applyTitle?: boolean; enabled?: boolean } = {},
) {
  const calls: {
    request?: unknown
    updates: [string, string, string, string][]
    published: unknown[]
  } = {
    updates: [],
    published: [],
  }
  const generate = createTitleGenerator({
    repo: {
      updateTitleIfCurrent: async (...args: [string, string, string, string]) => {
        calls.updates.push(args)
        return options.applyTitle ?? true
      },
      getSession: async () => ({ id: 's1', title: 'Generated title' }),
    } as never,
    readAgentSettings: async () => ({
      modelRouting:
        options.configured === false
          ? {}
          : {
              titleGeneration: {
                providerConnectionId: 'connection-1',
                modelId: 'title-model',
                ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
              },
            },
    }),
    buildLanguageModel: async () =>
      ({
        providerConnectionId: 'connection-1',
        model: {
          complete: async (request: LanguageModelRequest) => {
            calls.request = request
            return { content: 'Generated title', usage: { inputTokens: 10, outputTokens: 4 } }
          },
        },
      }) as never,
    publishSession: (session) => calls.published.push(session),
    publishPhase: () => {},
  })
  return { calls, generate }
}

describe('cleanGeneratedTitle', () => {
  test('passes a clean plain-string title through', () => {
    expect(cleanGeneratedTitle('Fix the login bug')).toBe('Fix the login bug')
  })

  test('keeps only the first line', () => {
    expect(cleanGeneratedTitle('Refactor auth\nsome rambling explanation')).toBe('Refactor auth')
  })

  test('strips surrounding quotes and trailing punctuation', () => {
    expect(cleanGeneratedTitle('"Add dark mode."')).toBe('Add dark mode')
    expect(cleanGeneratedTitle('«Improve search»')).toBe('Improve search')
    expect(cleanGeneratedTitle("  'Trim me'  ")).toBe('Trim me')
  })

  test('concatenates text content blocks and ignores non-text blocks', () => {
    const content = [
      { type: 'text', text: 'Build ' },
      { type: 'thinking', text: 'hmm' },
      { type: 'text', text: 'the parser' },
    ]
    expect(cleanGeneratedTitle(content)).toBe('Build the parser')
  })

  test('caps the title at 60 characters (before the trailing trim)', () => {
    const out = cleanGeneratedTitle('y'.repeat(80))
    expect(out).toBe('y'.repeat(60))
    expect(out.length).toBe(60)
  })

  test('returns an empty string for empty / unusable content', () => {
    expect(cleanGeneratedTitle('')).toBe('')
    expect(cleanGeneratedTitle(null)).toBe('')
    expect(cleanGeneratedTitle([])).toBe('')
    expect(cleanGeneratedTitle([{ type: 'image', text: 'x' }])).toBe('')
  })

  test('uses linked-context labels without copying attachment contents', () => {
    const rendered = renderInputIntentContext(
      buildInputIntentContext('Check @resource:localix://resource/git/project/status', [
        { kind: 'text', name: 'private.sql', text: 'DROP DATABASE', size: 13 },
      ]),
    )
    expect(rendered).toContain('private.sql')
    expect(rendered).not.toContain('DROP DATABASE')
  })

  test('uses the v2 model-task wrapper and applies only the expected fallback title', async () => {
    const { calls, generate } = titleHarness()
    generate(
      'u1',
      's1',
      'New Chat',
      'Check parser',
      'Check @resource:localix://resource/git/project/status',
      undefined,
      'high',
    )
    await flush()

    expect(calls.updates).toEqual([['u1', 's1', 'Check parser', 'Generated title']])
    expect(calls.published).toHaveLength(1)
    expect(calls.request).toMatchObject({
      systemPrompt: expect.stringContaining('You name chat sessions'),
      messages: [expect.objectContaining({ role: 'user' })],
      signal: expect.any(AbortSignal),
      reasoningEffort: 'high',
    })
    expect(calls.request).not.toHaveProperty('model')
  })

  test('does not select a provider when title generation is not configured', async () => {
    const { calls, generate } = titleHarness({ configured: false })
    generate('u1', 's1', 'New Chat', 'Check parser', 'Check parser')
    await flush()

    expect(calls.updates).toEqual([])
    expect(calls.published).toEqual([])
  })

  test('does not call the saved title model while title generation is off', async () => {
    const { calls, generate } = titleHarness({ enabled: false })
    generate('u1', 's1', 'New Chat', 'Check parser', 'Check parser')
    await flush()

    expect(calls.request).toBeUndefined()
    expect(calls.updates).toEqual([])
  })

  test('does not publish a generated title when compare-and-set loses to a user rename', async () => {
    const { calls, generate } = titleHarness({ applyTitle: false })
    generate('u1', 's1', 'New Chat', 'Check parser', 'Check parser')
    await flush()

    expect(calls.updates).toEqual([['u1', 's1', 'Check parser', 'Generated title']])
    expect(calls.published).toEqual([])
  })
})
