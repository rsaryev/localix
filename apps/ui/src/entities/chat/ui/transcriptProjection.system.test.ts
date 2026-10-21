import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { applyStreamEventToSession } from '@/shared/api/applyStreamEvent'
import type { UiSession } from '@/shared/api/contracts'
import { mergeSessionBody } from '../model/mergeSessionBody'
import type { Message } from '../model/types'
import { createTranscriptProjectionSelector } from './transcriptProjection'
import { inlineNoticeSegments } from './inlineNoticeSegments'
import { MessageBody } from './MessageBody'
import { SystemNoticeLine } from './SystemNoticeLine'
import { CommandOutputLine } from './CommandOutputLine'

const assistant: Message = { id: 'a1', role: 'assistant', content: 'Working' }
const notice = (id: string, text = 'A', itemId?: string): Message => ({
  id,
  role: 'system',
  afterMessageId: 'a1',
  withinMessage: itemId ? { itemId } : { contentOffset: 7 },
  systemNotice: { kind: 'hook_notice', tone: 'neutral', text },
})
const inline = (message: Message) =>
  inlineNoticeSegments(message).flatMap((segment) =>
    segment.kind === 'notice' ? [segment.message] : [],
  )

describe('central system deduplication in display order', () => {
  test('linked continuation appends and tail updates repair the original item without replays', () => {
    const item = {
      id: 'tool',
      type: 'tool_call' as const,
      toolCallId: 'tool',
      name: 'task',
      activeVerb: 'Running',
      status: 'running' as const,
      input: {},
    }
    const first: Message = { ...assistant, items: [item] }
    const next: Message = {
      id: 'a2',
      role: 'assistant',
      continuedFromMessageId: 'a1',
      items: [
        { ...item, status: 'completed', resultText: 'Done' },
        { id: 'text', type: 'text', status: 'running', text: 'Next' },
      ],
    }
    const project = createTranscriptProjectionSelector()
    project([first])
    const appended = project([first, next])
    expect(appended[0]?.items?.[0]).toMatchObject({ status: 'completed', resultText: 'Done' })
    expect(appended[1]?.items?.map((entry) => entry.id)).toEqual(['text'])
    const updated: Message = {
      ...next,
      items: [{ ...item, status: 'failed', resultText: 'Failed' }, next.items![1]!],
    }
    const tail = project([first, updated])
    expect(tail[0]?.items?.[0]).toMatchObject({ status: 'failed', resultText: 'Failed' })
    expect(tail[1]?.items?.map((entry) => entry.id)).toEqual(['text'])
    expect(first.items?.[0]?.status).toBe('running')
  })

  test('failed activity stays visible while routine events are grouped', () => {
    const activity = notice('routine', 'Input')
    activity.systemNotice = {
      ...activity.systemNotice!,
      activity: { id: 'job', state: 'completed' },
    }
    const failed: Message = {
      ...notice('failed', 'Failed'),
      systemNotice: {
        ...notice('failed').systemNotice!,
        text: 'Failed',
        activity: { id: 'job', state: 'failed' },
      },
    }
    const segments = inlineNoticeSegments(
      createTranscriptProjectionSelector()([assistant, activity, failed])[0]!,
    )
    expect(segments.map((segment) => segment.kind)).toEqual(['body', 'notice'])
    expect(segments[0]?.kind === 'body' && segments[0].activity?.[0]?.id).toBe('routine')
    expect(segments[1]?.kind === 'notice' && segments[1].message.id).toBe('failed')
  })

  test('coalesces durable standalone notices without a terminal or an arrival anchor', () => {
    const first = { ...notice('first'), afterMessageId: undefined, withinMessage: undefined }
    const second = { ...first, id: 'second', createdAt: '2030-01-01T00:00:00Z' }
    const projected = createTranscriptProjectionSelector()([first, second, assistant])
    expect(projected.map((message) => message.id)).toEqual(['first', 'a1'])
    expect(projected[0]?.systemRepeatCount).toBe(2)
    const html = renderToStaticMarkup(
      createElement(SystemNoticeLine, {
        notice: projected[0]!.systemNotice!,
        repeatCount: projected[0]!.systemRepeatCount,
      }),
    )
    expect(html).toContain('A ×2')
  })

  test('A A B A becomes A ×2 B A inside an assistant reply', () => {
    const projected = createTranscriptProjectionSelector()([
      assistant,
      notice('first'),
      notice('second'),
      notice('third', 'B'),
      notice('fourth'),
    ])
    expect(
      inline(projected[0]!).map((message) => [
        message.systemNotice?.text,
        message.systemRepeatCount ?? 1,
      ]),
    ).toEqual([
      ['A', 2],
      ['B', 1],
      ['A', 1],
    ])
  })

  test('body blocks between notices break a run, while date and text offset do not', () => {
    const message: Message = {
      ...assistant,
      items: ['first', 'second'].map((id) => ({ id, type: 'text', status: 'completed', text: id })),
      inlineNotices: [
        notice('a', 'A', 'first'),
        notice('b', 'A', 'second'),
        { ...notice('c', 'A', 'second'), withinMessage: { itemId: 'second', textOffset: 100 } },
      ],
    }
    expect(inline(message).map((entry) => entry.systemRepeatCount ?? 1)).toEqual([1, 2])
    expect(inlineNoticeSegments(message).map((segment) => segment.kind)).toEqual([
      'body',
      'notice',
      'body',
      'notice',
    ])
  })

  test('terminal replay and body refetch never inflate the visible count', () => {
    let current = { id: 'sess-1', messages: [assistant], isRunning: true } as UiSession
    const project = createTranscriptProjectionSelector()
    for (const terminalId of ['pty-1', 'pty-2', 'pty-2']) {
      current = applyStreamEventToSession(current, {
        type: 'terminal.finished',
        sessionId: 'sess-1',
        terminalId,
        exitCode: 0,
      })
      project(current.messages)
    }
    const merged = mergeSessionBody(current, { ...current, messages: [assistant] })
    const segment = inlineNoticeSegments(project(merged.messages)[0]!)[0]
    expect(segment?.kind === 'body' && segment.activity?.[0]?.systemRepeatCount).toBe(2)
    expect(project(merged.messages)).toEqual(createTranscriptProjectionSelector()(merged.messages))
  })

  test('a pending warning does not make subsequent routine notices display early', () => {
    const message: Message = {
      ...assistant,
      items: [{ id: 'first', type: 'text', status: 'running', text: 'Working' }],
      inlineNotices: [
        {
          ...notice('warn', 'Warning', 'first'),
          systemNotice: { kind: 'hook_notice', tone: 'warning', text: 'Warning' },
        },
        notice('routine', 'Routine', 'first'),
        notice('repeat', 'Routine', 'first'),
      ],
    }
    expect(inlineNoticeSegments(message, true).map((segment) => segment.kind)).toEqual([
      'body',
      'notice',
      'pending',
    ])
    const pending = inlineNoticeSegments(message, true).at(-1)
    expect(pending?.kind === 'pending' && pending.messages[0]?.systemRepeatCount).toBe(2)
  })

  test('command output and plain system text show the same repeat count', () => {
    const html = renderToStaticMarkup(
      createElement(CommandOutputLine, {
        output: { command: 'help', tone: 'neutral', text: 'Done' },
        repeatCount: 3,
      }),
    )
    expect(html).toContain('Done ×3')
    const plain = renderToStaticMarkup(
      MessageBody({
        message: { id: 'plain', role: 'system', content: 'Done', systemRepeatCount: 3 },
        isUser: false,
      }),
    )
    expect(plain).toContain('Done ×3')
  })
})
