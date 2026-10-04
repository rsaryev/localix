import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { applyStreamEventToSession } from '@/shared/api/applyStreamEvent'
import type { AgentStreamEvent, UiSession } from '@/shared/api/contracts'
import type { Message } from '../model/types'
import { inlineNoticeSegments } from './inlineNoticeSegments'
import { createTranscriptProjectionSelector } from './transcriptProjection'
import { mergeSessionBody } from '../model/mergeSessionBody'
import { MessageBody } from './MessageBody'

const event = (value: Record<string, unknown>) => value as AgentStreamEvent
const assistant = (items: unknown[]): Message =>
  ({ id: 'assistant-1', role: 'assistant', items }) as Message
const session = (message: Message): UiSession =>
  ({ id: 'sess-1', isRunning: true, messages: [message] }) as UiSession
const text = (id: string, value: string) => ({ id, type: 'text', status: 'completed', text: value })
const tool = (id: string) => ({ id, type: 'tool_call', status: 'running', name: 'bash' })
const body = (message: Message) =>
  inlineNoticeSegments(message).map((segment) =>
    segment.kind === 'notice'
      ? segment.message.systemNotice?.text
      : (segment.items?.map((item) => ('text' in item ? item.text : item.id)).join('') ??
        segment.content),
  )

describe('notices inside a growing assistant reply', () => {
  test('keeps a hook system message beside the item that triggered it', () => {
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

  test('the terminal exit stays between tools even as the same reply grows', () => {
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
    expect(body(projected[0]!)).toEqual([
      'Beforefirst-tool',
      'Background terminal finished',
      'After',
    ])
  })

  test('preserves the in-reply boundary through a whole-body refetch', () => {
    let current = session(assistant([text('part', 'Before')]))
    current = applyStreamEventToSession(
      current,
      event({ type: 'terminal.finished', sessionId: 'sess-1', terminalId: 'pty-3', exitCode: 0 }),
    )
    const fresh = session(assistant([text('part', 'Before and after')]))
    const merged = mergeSessionBody(current, fresh)
    const projected = createTranscriptProjectionSelector()(merged.messages)
    expect(body(projected[0]!)).toEqual(['Before', 'Background terminal finished', ' and after'])
  })

  test('cuts a growing text item at the exact arrival offset, including repeated notices', () => {
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
    expect(body(projected[0]!)).toEqual([
      'Hello',
      'Interacted with background terminal',
      ' world',
      'Interacted with background terminal',
      '!',
    ])
    const html = renderToStaticMarkup(MessageBody({ message: projected[0]!, isUser: false }))
    expect(html.indexOf('Hello')).toBeLessThan(html.indexOf('Interacted with background terminal'))
    expect(html.indexOf('Interacted with background terminal')).toBeLessThan(html.indexOf('world'))
  })

  test('places a notice before content that arrives after an empty assistant skeleton', () => {
    let current = session({ id: 'assistant-1', role: 'assistant', content: '' })
    current = applyStreamEventToSession(
      current,
      event({ type: 'terminal.finished', sessionId: 'sess-1', terminalId: 'pty-2', exitCode: 0 }),
    )
    current = {
      ...current,
      messages: [{ id: 'assistant-1', role: 'assistant', content: 'Later' }, current.messages[1]!],
    }
    expect(body(createTranscriptProjectionSelector()(current.messages)[0]!)).toEqual([
      'Background terminal finished',
      'Later',
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
