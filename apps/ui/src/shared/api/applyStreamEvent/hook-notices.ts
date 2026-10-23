/** Bounded hook notices and plugin problem pointers in the transcript. */
import { settingsEntityAnchor } from '@localixai/mini-app-sdk/navigation'
import { pluginLabel } from '@/shared/contrib/pluginAttribution'
import type { StreamEventOf, StreamReducers } from './types'
import { noticePosition } from './notice-position'

const MAX_HOOK_NOTICES = 5
let hookNoticeCounter = 0

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

export const hookNoticeReducers: StreamReducers<'hook.notice'> = {
  'hook.notice': (session, event) => {
    // A CC hook returned a non-blocking `systemMessage` — surface it as an inline
    // compact system notice anchored after the latest conversation message.
    if (event.sessionId !== session.id) return session
    hookNoticeCounter += 1
    const anchorMsg = [...session.messages]
      .reverse()
      .find((m) => m.role !== 'system' && !m.isInternal)
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
}
