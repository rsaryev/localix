/**
 * Client-only system notices in the transcript: a CC hook's `systemMessage`, and the lifecycle
 * of a background terminal (waiting on it, typing into it, its exit). Both are ephemeral and
 * BOUNDED — the oldest is evicted at the cap — so a chatty producer cannot grow the transcript.
 */
import { latestActiveTerminalWait } from '@localixai/agent'
import { settingsEntityAnchor } from '@localixai/plugin-sdk/navigation'

import { pluginLabel } from '@/shared/contrib/pluginAttribution'
import type { UiSession } from '../contracts'
import type { StreamEventOf, StreamReducers } from './types'

/** Max number of hook `systemMessage` notices kept in a transcript (bounded, oldest evicted). */
const MAX_HOOK_NOTICES = 5
let hookNoticeCounter = 0
const MAX_TERMINAL_LIFECYCLE_NOTICES = 20
let terminalLifecycleCounter = 0

type TerminalLifecycleEvent = StreamEventOf<
  'terminal.waiting' | 'terminal.input' | 'terminal.finished'
>

/** Freeze the live item's boundary before subsequent deltas grow the same reply. */
export function noticePosition(
  session: UiSession,
  anchor: UiSession['messages'][number] | undefined,
) {
  if (anchor?.role !== 'assistant' || !session.isRunning) return undefined
  const item = anchor.items?.at(-1)
  if (item) {
    return {
      itemId: item.id,
      ...('text' in item && typeof item.text === 'string' ? { textOffset: item.text.length } : {}),
    }
  }
  return { contentOffset: anchor.content?.length ?? 0 }
}

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
  const anchor = [...session.messages].reverse().find((message) => message.role !== 'system')
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
      systemNotice: { ...tail.systemNotice!, text },
      terminalLifecycle: {
        ...tail.terminalLifecycle,
        active,
        count: tail.terminalLifecycle.count + 1,
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
    },
    terminalLifecycle: {
      kind,
      terminalId: event.terminalId,
      active,
      count: 1,
      label,
    },
  }
  const existing = session.messages.filter((message) => message.terminalLifecycle)
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
  systemNotice: { ...message.systemNotice!, text: 'Waited for background terminal' },
  terminalLifecycle: { ...message.terminalLifecycle!, active: false },
})

const isActiveWait = (message: UiSession['messages'][number], terminalId: string): boolean =>
  message.terminalLifecycle?.kind === 'waiting' &&
  message.terminalLifecycle.terminalId === terminalId &&
  Boolean(message.terminalLifecycle.active)

/**
 * Who said it, then the producer's raw text when it had one.
 *
 * The raw text used to REPLACE the producer (`detail ?? Hook: …`), so exactly the notices worth
 * reading closely — a plugin's, with the driver's words attached — were the ones that lost which
 * plugin they came from. A plugin is named by its display name, not the id `hookEvent` carries.
 */
function noticeDetail(event: StreamEventOf<'hook.notice'>): string {
  const producer = event.plugin
    ? `Plugin: ${[pluginLabel(event.plugin.name), event.plugin.source].filter(Boolean).join(' · ')}`
    : `Hook: ${event.hookEvent}`
  return event.detail ? `${producer}\n${event.detail}` : producer
}

/**
 * A plugin's problem in the transcript is a POINTER, not a second report.
 *
 * The same `ctx.reportProblem` raises a standing condition (`conditions/plugins.ts`): one row per
 * problem, deduped, settled when it stops, carrying the plugin's settings action. The transcript
 * line used to repeat it as an amber warning in every conversation it fired in, so one problem
 * read as N. What the conversation still needs is WHEN it happened, so the line stays — neutral,
 * naming the plugin, with the problem as its detail and the same settings destination as the row.
 */
function pluginProblemPointer(event: StreamEventOf<'hook.notice'>, pluginName: string) {
  return {
    kind: 'hook_notice' as const,
    tone: 'neutral' as const,
    text: `${pluginLabel(pluginName)} reported a problem`,
    detail: [event.message, noticeDetail(event)].join('\n'),
    recovery: [`open-settings:plugins/${settingsEntityAnchor('plugin', pluginName)}` as const],
  }
}

export const noticeReducers: StreamReducers<
  'hook.notice' | 'terminal.waiting' | 'terminal.input' | 'terminal.finished'
> = {
  'hook.notice': (session, event) => {
    // A CC hook returned a non-blocking `systemMessage` — surface it as an inline
    // compact system notice anchored after the latest conversation message.
    if (event.sessionId !== session.id) return session
    hookNoticeCounter += 1
    const anchorMsg = [...session.messages].reverse().find((m) => m.role !== 'system')
    const notice = {
      id: `sys-hook_notice-${Date.now()}-${hookNoticeCounter}`,
      createdAt: new Date().toISOString(),
      role: 'system' as const,
      clientOnly: true as const,
      afterMessageId: anchorMsg?.id ?? null,
      withinMessage: noticePosition(session, anchorMsg),
      systemNotice: event.plugin
        ? pluginProblemPointer(event, event.plugin.name)
        : {
            kind: 'hook_notice' as const,
            tone: 'warning' as const,
            text: event.message,
            detail: noticeDetail(event),
          },
    }
    // Evict the oldest hook notice once we're at the cap.
    const existing = session.messages.filter((m) => m.systemNotice?.kind === 'hook_notice')
    const base =
      existing.length >= MAX_HOOK_NOTICES
        ? session.messages.filter((m) => m.id !== existing[0]?.id)
        : session.messages
    return { ...session, messages: [...base, notice] }
  },

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
    return {
      ...next,
      activePhase:
        session.activePhase?.id === `terminal-wait:${event.terminalId}`
          ? activeTerminalWaitPhase(settled.messages)
          : session.activePhase,
    }
  },
}
