import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { applyStreamEventToSession } from '@/shared/api/applyStreamEvent'
import type { AgentStreamEvent, UiSession } from '@/shared/api/contracts'
import type { Message } from '../model/types'
import { inlineNoticeSegments } from './inlineNoticeSegments'
import { createTranscriptProjectionSelector } from './transcriptProjection'
import { mergeSessionBody } from '../model/mergeSessionBody'
import { MessageBody } from './MessageBody'
import { systemMessageLabel } from './coalesceSystemMessages'

const event = (value: Record<string, unknown>) => value as AgentStreamEvent
const assistant = (items: unknown[]): Message =>
  ({ id: 'assistant-1', role: 'assistant', items }) as Message
const session = (message: Message): UiSession =>
  ({ id: 'sess-1', isRunning: true, messages: [message] }) as UiSession
const text = (id: string, value: string) => ({
  id,
  type: 'text' as const,
  status: 'completed' as const,
  text: value,
})
const tool = (id: string) => ({ id, type: 'tool_call', status: 'running', name: 'bash' })
const body = (message: Message) =>
  inlineNoticeSegments(message).map((segment) =>
    segment.kind === 'notice'
      ? systemMessageLabel(
          segment.message.systemNotice?.text ?? '',
          segment.message.systemRepeatCount,
        )
      : segment.kind === 'pending'
        ? `pending:${segment.messages.length}`
        : (segment.items?.map((item) => ('text' in item ? item.text : item.id)).join('') ??
          segment.content),
  )

describe('notices inside a growing assistant reply', () => {
  test('keeps a hook notice at its captured output-block boundary', () => {
    let current = session(assistant([text('first', 'Working')]))
    current = applyStreamEventToSession(
      current,
      event({
        type: 'hook.notice',
        sessionId: 'sess-1',
        hookEvent: 'PostToolUse',
        message: 'Check the result',
      }),
    )
    current = {
      ...current,
      messages: [
        assistant([text('first', 'Working'), text('second', 'Continuing')]),
        current.messages[1]!,
      ],
    }
    expect(body(createTranscriptProjectionSelector()(current.messages)[0]!)).toEqual([
      'Working',
      'Check the result',
      'Continuing',
    ])
  })

  test('keeps routine terminal activity inside its action block as later text arrives', () => {
    let current = session(assistant([text('intro', 'Before'), tool('first-tool')]))
    current = applyStreamEventToSession(
      current,
      event({
        type: 'terminal.finished',
        sessionId: 'sess-1',
        terminalId: 'pty-1',
        command: 'build',
        exitCode: 0,
      }),
    )
    expect(current.messages[1]?.withinMessage).toEqual({ itemId: 'first-tool' })
    current = {
      ...current,
      messages: [
        assistant([text('intro', 'Before'), tool('first-tool'), text('outro', 'After')]),
        current.messages[1]!,
      ],
    }
    const projected = createTranscriptProjectionSelector()(current.messages)
    expect(projected.map((message) => message.id)).toEqual(['assistant-1'])
    expect(body(projected[0]!)).toEqual(['Beforefirst-toolAfter'])
    const segment = inlineNoticeSegments(projected[0]!)[0]
    expect(segment?.kind === 'body' && segment.activity?.[0]?.withinMessage).toEqual({
      itemId: 'first-tool',
    })
  })

  test('keeps notices below the reply through a whole-body refetch', () => {
    let current = session(assistant([text('part', 'Before')]))
    current = applyStreamEventToSession(
      current,
      event({ type: 'terminal.finished', sessionId: 'sess-1', terminalId: 'pty-3', exitCode: 0 }),
    )
    const fresh = session(assistant([text('part', 'Before and after')]))
    const merged = mergeSessionBody(current, fresh)
    const projected = createTranscriptProjectionSelector()(merged.messages)
    expect(body(projected[0]!)).toEqual(['Before and after'])
    expect(projected[0]?.inlineNotices?.[0]?.systemNotice?.activity?.state).toBe('completed')
  })

  test('keeps text whole and coalesces repeated terminal input notices', () => {
    let current = session(assistant([text('part', 'Hello')]))
    current = applyStreamEventToSession(
      current,
      event({ type: 'terminal.input', sessionId: 'sess-1', terminalId: 'pty-1', label: 'Enter' }),
    )
    current = {
      ...current,
      messages: [assistant([text('part', 'Hello world')]), current.messages[1]!],
    }
    current = applyStreamEventToSession(
      current,
      event({ type: 'terminal.input', sessionId: 'sess-1', terminalId: 'pty-1', label: 'Enter' }),
    )
    expect(current.messages).toHaveLength(3)
    current = {
      ...current,
      messages: [assistant([text('part', 'Hello world!')]), ...current.messages.slice(1)],
    }
    const projected = createTranscriptProjectionSelector()(current.messages)
    expect(body(projected[0]!)).toEqual(['Hello world!'])
    const html = renderToStaticMarkup(MessageBody({ message: projected[0]!, isUser: false }))
    expect(html).toContain('Hello world!')
    expect(html).toContain('System activity')
    expect(html).not.toContain('Interacted with background terminal')
  })

  test('keeps flat content whole when it arrives after an empty assistant skeleton', () => {
    let current = session({ id: 'assistant-1', role: 'assistant', content: '' })
    current = applyStreamEventToSession(
      current,
      event({ type: 'terminal.finished', sessionId: 'sess-1', terminalId: 'pty-2', exitCode: 0 }),
    )
    current = {
      ...current,
      messages: [{ id: 'assistant-1', role: 'assistant', content: 'Later' }, current.messages[1]!],
    }
    expect(body(createTranscriptProjectionSelector()(current.messages)[0]!)).toEqual(['Later'])
  })

  test('does not split Markdown fences or change text item identity', () => {
    const item = text('code', '```ts\nconst value = 42\n```')
    const message = assistant([item])
    message.inlineNotices = [
      {
        id: 'notice',
        role: 'system',
        withinMessage: { itemId: 'code', textOffset: 12 },
        systemNotice: { kind: 'terminal_activity', tone: 'neutral', text: 'Finished' },
      },
    ]
    const segments = inlineNoticeSegments(message)
    expect(segments).toHaveLength(2)
    expect(segments[0]).toEqual({ kind: 'body', items: [item] })
    if (segments[0]?.kind === 'body') expect(segments[0].items?.[0]).toBe(item)
    const html = renderToStaticMarkup(MessageBody({ message, isUser: false }))
    expect(html.match(/<pre\b/g)).toHaveLength(1)
    expect(html.replace(/<[^>]*>/g, '')).toContain('const value = 42')
  })

  test('defers routine events until an explicit narrative block closes, with no text slicing', () => {
    const item = { ...text('part', 'An unfinished **sentence'), status: 'running' as const }
    const message = assistant([item])
    message.inlineNotices = [
      {
        id: 'event',
        role: 'system',
        withinMessage: { itemId: 'part', textOffset: 4 },
        systemNotice: { kind: 'terminal_activity', tone: 'neutral', text: 'Done' },
      },
    ]
    expect(inlineNoticeSegments(message, true).map((segment) => segment.kind)).toEqual([
      'body',
      'pending',
    ])
    const grown = { ...message, items: [{ ...item, text: 'An unfinished **sentence**.' }] }
    expect(inlineNoticeSegments(grown, true)[0]).toEqual({ kind: 'body', items: grown.items })
    expect(inlineNoticeSegments(grown, true)[1]?.kind).toBe('pending')
    const closed = { ...grown, items: [{ ...grown.items[0]!, status: 'completed' as const }] }
    expect(inlineNoticeSegments(closed, true)[1]?.kind).toBe('notice')
    const continued = { ...grown, items: [...grown.items, text('next', 'Next block')] }
    expect(inlineNoticeSegments(continued, true).map((segment) => segment.kind)).toEqual([
      'body',
      'notice',
      'body',
    ])
    expect(inlineNoticeSegments(continued, false)).toEqual(inlineNoticeSegments(continued, true))
  })

  test('warning and recovery events are never deferred, even while their text block grows', () => {
    const message = assistant([{ ...text('part', 'Working'), status: 'running' }])
    message.inlineNotices = [
      {
        id: 'warn',
        role: 'system',
        withinMessage: { itemId: 'part' },
        systemNotice: { kind: 'hook_notice', tone: 'warning', text: 'Warning' },
      },
      {
        id: 'action',
        role: 'system',
        withinMessage: { itemId: 'part' },
        systemNotice: { kind: 'run_failed', tone: 'neutral', text: 'Retry', recovery: ['retry'] },
      },
    ]
    expect(inlineNoticeSegments(message, true).map((segment) => segment.kind)).toEqual([
      'body',
      'notice',
      'notice',
    ])
  })

  test('missing anchors keep events visible, and evicted notices leave no retained queue', () => {
    const message = assistant([text('part', 'Text')])
    message.inlineNotices = [
      {
        id: 'missing',
        role: 'system',
        withinMessage: { itemId: 'removed' },
        systemNotice: { kind: 'terminal_activity', tone: 'neutral', text: 'Done' },
      },
    ]
    expect(inlineNoticeSegments(message, true).map((segment) => segment.kind)).toEqual([
      'body',
      'notice',
    ])
    expect(inlineNoticeSegments({ ...message, inlineNotices: [] }, true)).toEqual([
      { kind: 'body', items: message.items, content: message.content },
    ])
  })

  test('leaves completed-message notices and notices anchored to users as separate rows', () => {
    const notice = {
      id: 'notice',
      role: 'system' as const,
      afterMessageId: 'assistant-1',
      systemNotice: { kind: 'terminal_activity' as const, tone: 'neutral' as const, text: 'Done' },
    }
    const messages = [assistant([text('part', 'Done')]), notice]
    expect(createTranscriptProjectionSelector()(messages).map((message) => message.id)).toEqual([
      'assistant-1',
      'notice',
    ])
  })
})
