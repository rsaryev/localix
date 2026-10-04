import { describe, expect, test } from 'bun:test'

import { applyStreamEventToSession } from './applyStreamEvent'
import type { AgentStreamEvent, UiSession } from './contracts'

const session = (over: Partial<UiSession> = {}) =>
  ({
    id: 'sess-1',
    messages: [],
    isRunning: true,
    pendingInteraction: null,
    pendingInteractionQueue: [],
    activePhase: null,
    ...over,
  }) as UiSession

const event = (value: Record<string, unknown>) => value as AgentStreamEvent

describe('Web terminal lifecycle', () => {
  test('shows and settles one active wait row and status', () => {
    let next = applyStreamEventToSession(
      session(),
      event({
        type: 'terminal.waiting',
        sessionId: 'sess-1',
        terminalId: 'pty-1',
        active: true,
        label: 'waiting for prompt',
      }),
    )
    expect(next.messages[0]?.systemNotice?.text).toBe('Waiting for background terminal')
    expect(next.activePhase?.label).toBe('waiting for prompt')

    next = applyStreamEventToSession(
      next,
      event({
        type: 'terminal.waiting',
        sessionId: 'sess-1',
        terminalId: 'pty-1',
        active: false,
      }),
    )
    expect(next.messages).toHaveLength(1)
    expect(next.messages[0]?.systemNotice?.text).toBe('Waited for background terminal')
    expect(next.activePhase).toBeNull()
  })

  test('coalesces input markers and never retains input bytes', () => {
    let next = session()
    for (const label of ['user input', 'Enter']) {
      next = applyStreamEventToSession(
        next,
        event({
          type: 'terminal.input',
          sessionId: 'sess-1',
          terminalId: 'pty-1',
          source: 'user',
          label,
        }),
      )
    }
    expect(next.messages).toHaveLength(1)
    expect(next.messages[0]?.terminalLifecycle?.count).toBe(2)
    expect(JSON.stringify(next.messages)).not.toContain('literal secret')
  })

  test('finished settles a matching terminal wait status', () => {
    const waiting = applyStreamEventToSession(
      session(),
      event({
        type: 'terminal.waiting',
        sessionId: 'sess-1',
        terminalId: 'pty-1',
        active: true,
      }),
    )
    const finished = applyStreamEventToSession(
      waiting,
      event({
        type: 'terminal.finished',
        sessionId: 'sess-1',
        terminalId: 'pty-1',
        exitCode: 130,
        command: 'npm test',
      }),
    )
    expect(finished.messages[finished.messages.length - 1]?.systemNotice?.text).toBe(
      'Background terminal finished',
    )
    expect(finished.messages[0]?.systemNotice?.text).toBe('Waited for background terminal')
    expect(finished.messages[0]?.terminalLifecycle?.active).toBe(false)
    expect(finished.activePhase).toBeNull()

    const replayed = applyStreamEventToSession(
      finished,
      event({
        type: 'terminal.finished',
        sessionId: 'sess-1',
        terminalId: 'pty-1',
        exitCode: 130,
        command: 'npm test',
      }),
    )
    expect(replayed.messages).toHaveLength(finished.messages.length)
    expect(
      replayed.messages.filter((message) => message.terminalLifecycle?.kind === 'finished'),
    ).toHaveLength(1)
  })

  test('falls back to another active terminal wait when the newest one finishes', () => {
    let next = session()
    for (const [terminalId, label] of [
      ['pty-1', 'first prompt'],
      ['pty-2', 'second prompt'],
    ]) {
      next = applyStreamEventToSession(
        next,
        event({ type: 'terminal.waiting', sessionId: 'sess-1', terminalId, active: true, label }),
      )
    }
    expect(next.activePhase?.id).toBe('terminal-wait:pty-2')

    next = applyStreamEventToSession(
      next,
      event({
        type: 'terminal.finished',
        sessionId: 'sess-1',
        terminalId: 'pty-2',
        exitCode: 0,
      }),
    )

    expect(next.activePhase).toEqual({ id: 'terminal-wait:pty-1', label: 'first prompt' })
  })
})
