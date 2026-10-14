/** Bounded terminal lifecycle notices, replay settlement, and active wait phases. */
import { latestActiveTerminalWait } from '@localixai/agent'
import type { UiSession } from '../contracts'
import type { StreamEventOf, StreamReducers } from './types'
import { noticePosition } from './notice-position'

const MAX_TERMINAL_LIFECYCLE_NOTICES = 20
let terminalLifecycleCounter = 0

type TerminalLifecycleEvent = StreamEventOf<
  'terminal.waiting' | 'terminal.input' | 'terminal.finished'
>

function terminalLifecycleNotice(
  session: UiSession,
  event: TerminalLifecycleEvent,
  kind: 'waiting' | 'input' | 'finished',
  text: string,
  active?: boolean,
): UiSession {
  const label = event.type === 'terminal.finished' ? event.command : event.label
  // Exit frames are replayable by terminalId so reconnect can recover a missed
  // completion. Re-applying the same fact settles state but never creates another
  // transcript notice or increments its interaction count.
  if (
    kind === 'finished' &&
    session.messages.some(
      (message) =>
        message.terminalLifecycle?.kind === 'finished' &&
        message.terminalLifecycle.terminalId === event.terminalId,
    )
  ) {
    return session
  }
  const tail = session.messages.at(-1)
  const anchor = [...session.messages]
    .reverse()
    .find((message) => message.role !== 'system' && !message.isInternal)
  const withinMessage = noticePosition(session, anchor)
  if (
    tail?.terminalLifecycle?.kind === kind &&
    tail.terminalLifecycle.terminalId === event.terminalId &&
    tail.afterMessageId === (anchor?.id ?? null) &&
    JSON.stringify(tail.withinMessage) === JSON.stringify(withinMessage)
  ) {
    const messages = session.messages.slice()
    messages[messages.length - 1] = {
      ...tail,
      systemRepeatCount: (tail.systemRepeatCount ?? 1) + (kind === 'waiting' ? 0 : 1),
      systemNotice: {
        ...tail.systemNotice!,
        text,
        activity: { id: `terminal:${event.terminalId}`, state: active ? 'running' : 'completed' },
      },
      terminalLifecycle: {
        ...tail.terminalLifecycle,
        active,
        count: tail.terminalLifecycle.count + (kind === 'waiting' ? 0 : 1),
        label,
      },
    }
    return { ...session, messages }
  }

  terminalLifecycleCounter += 1
  const notice = {
    id: `sys-terminal-${kind}-${Date.now()}-${terminalLifecycleCounter}`,
    createdAt: new Date().toISOString(),
    role: 'system' as const,
    clientOnly: true as const,
    afterMessageId: anchor?.id ?? null,
    withinMessage,
    systemNotice: {
      kind: 'terminal_activity' as const,
      tone: 'neutral' as const,
      text,
      detail: label,
      activity: {
        id: `terminal:${event.terminalId}`,
        state: active ? ('running' as const) : ('completed' as const),
      },
    },
    terminalLifecycle: {
      kind,
      terminalId: event.terminalId,
      active,
      count: 1,
      label,
    },
  }
  const existing = session.messages.filter(
    (message) =>
      message.terminalLifecycle &&
      !(message.terminalLifecycle.kind === 'waiting' && message.terminalLifecycle.active),
  )
  const base =
    existing.length >= MAX_TERMINAL_LIFECYCLE_NOTICES
      ? session.messages.filter((message) => message.id !== existing[0]?.id)
      : session.messages
  return { ...session, messages: [...base, notice] }
}

function activeTerminalWaitPhase(messages: UiSession['messages']): UiSession['activePhase'] {
  const wait = latestActiveTerminalWait(messages)
  return wait
    ? {
        id: `terminal-wait:${wait.terminalId}`,
        label: wait.label ?? 'Waiting for background terminal',
      }
    : null
}

/** The wait notice for `terminalId`, marked as over. */
const endWait = (message: UiSession['messages'][number]): UiSession['messages'][number] => ({
  ...message,
  systemNotice: {
    ...message.systemNotice!,
    text: 'Waited for background terminal',
    activity: { id: `terminal:${message.terminalLifecycle!.terminalId}`, state: 'completed' },
  },
  terminalLifecycle: { ...message.terminalLifecycle!, active: false },
})

const isActiveWait = (message: UiSession['messages'][number], terminalId: string): boolean =>
  message.terminalLifecycle?.kind === 'waiting' &&
  message.terminalLifecycle.terminalId === terminalId &&
  Boolean(message.terminalLifecycle.active)

export const terminalNoticeReducers: StreamReducers<
  'terminal.waiting' | 'terminal.input' | 'terminal.finished'
> = {
  'terminal.waiting': (session, event) => {
    if (event.sessionId !== session.id) return session
    if (event.active) {
      const next = terminalLifecycleNotice(
        session,
        event,
        'waiting',
        'Waiting for background terminal',
        true,
      )
      return {
        ...next,
        activePhase: {
          id: `terminal-wait:${event.terminalId}`,
          label: event.label ?? 'Waiting for background terminal',
        },
      }
    }
    const index = session.messages.findLastIndex((message) =>
      isActiveWait(message, event.terminalId),
    )
    if (index < 0) return session
    const messages = session.messages.slice()
    messages[index] = endWait(messages[index]!)
    return {
      ...session,
      messages,
      activePhase:
        session.activePhase?.id === `terminal-wait:${event.terminalId}`
          ? activeTerminalWaitPhase(messages)
          : session.activePhase,
    }
  },

  'terminal.input': (session, event) =>
    event.sessionId === session.id
      ? terminalLifecycleNotice(session, event, 'input', 'Interacted with background terminal')
      : session,

  'terminal.finished': (session, event) => {
    if (event.sessionId !== session.id) return session
    // The PTY exit can be the last lifecycle frame observed across a reconnect;
    // do not depend exclusively on a later waiting:false from the tool finally.
    // Otherwise the transcript keeps claiming that this dead PTY is still waiting.
    const settled = {
      ...session,
      messages: session.messages.map((message) =>
        isActiveWait(message, event.terminalId) ? endWait(message) : message,
      ),
    }
    const next = terminalLifecycleNotice(settled, event, 'finished', 'Background terminal finished')
    const failed = event.exitCode !== 0 && !event.stopped && !event.interactive
    const messages = next.messages.map((message) => {
      if (
        message.terminalLifecycle?.kind !== 'finished' ||
        message.terminalLifecycle.terminalId !== event.terminalId
      )
        return message
      return {
        ...message,
        systemNotice: {
          ...message.systemNotice!,
          text: event.stopped
            ? 'Background terminal stopped'
            : failed
              ? `Background terminal exited (${event.exitCode})`
              : 'Background terminal finished',
          tone: failed ? ('error' as const) : ('neutral' as const),
          activity: {
            id: `terminal:${event.terminalId}`,
            state: event.stopped
              ? ('stopped' as const)
              : failed
                ? ('failed' as const)
                : ('completed' as const),
          },
        },
      }
    })
    return {
      ...next,
      messages,
      activePhase:
        session.activePhase?.id === `terminal-wait:${event.terminalId}`
          ? activeTerminalWaitPhase(settled.messages)
          : session.activePhase,
    }
  },
}
