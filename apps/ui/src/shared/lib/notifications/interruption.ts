import {
  notificationChannels,
  type NotificationContext,
  type NotificationEnvelope,
} from '@localixai/notifications'

import { isDesktop } from '@localixai/kit/environment'
import { notifyDesktop } from '@/shared/lib/desktopNotify'
import { eventSignalKey } from './signal'
import { isOriginOnScreen } from './context'
import { onLiveRaise } from './journal'
import { takeDeliveryHint } from './overlay'
import { notificationPreferences } from './prefs'
import { useNotificationsStore } from './store'
import type { NotificationEntry } from './types'

/**
 * WHETHER A ROW THAT JUST OPENED IS WORTH INTERRUPTING FOR — decided here, in the window, because
 * only the window knows whether it has focus and which chat is on screen.
 *
 * Only a change that arrives LIVE asks the question (`journal.ts` announces nothing from a sync):
 * what happened while this window was closed is history to read, not a banner to raise on
 * reconnect. The rules themselves are the shared policy's (`@localixai/notifications`): errors and
 * what waits on the person (category `human-input`) interrupt, within their TTL, respecting the
 * condition pref.
 */

/** How long a fact stays worth a banner — the same windows the envelope builders use. */
const TTL_MS = {
  waiting: 60 * 60_000,
  condition: 60 * 60_000,
  run: 10 * 60_000,
}

/**
 * What waits on the person, by the row's category rather than a list of topics: a list had to be
 * extended by hand for every new way of waiting (a presented plan) and missed
 * each one until someone noticed it never interrupted. The server files every such row as
 * `human-input`; the native kind and the hour-long TTL follow from that one field.
 */
const waitsOnPerson = (entry: NotificationEntry) => entry.category === 'human-input'

function envelopeOf(entry: NotificationEntry): NotificationEnvelope {
  return {
    id: entry.id,
    occurredAt: entry.lastSeenAt ?? entry.ts,
    event: {
      topic: entry.topic,
      category: entry.category,
      severity: entry.severity,
      title: entry.title,
      body: entry.message,
      source: { kind: 'application' },
      persistence: 'durable',
      actions: [],
      dedupeKey: entry.id,
      dedupeWindowMs: 0,
      ttlMs: waitsOnPerson(entry)
        ? TTL_MS.waiting
        : entry.condition
          ? TTL_MS.condition
          : TTL_MS.run,
    },
  }
}

const isOnScreen = (entry: NotificationEntry) => isOriginOnScreen(entry.origin)

export interface InterruptionDeps {
  notify?: typeof notifyDesktop
  desktop?: boolean
  focused?: () => boolean | 'unknown'
}

function interruptFor(entry: NotificationEntry, deps: InterruptionDeps = {}): void {
  const hint = takeDeliveryHint(entry.id)
  const focused =
    deps.focused?.() ?? (typeof document === 'undefined' ? 'unknown' : document.hasFocus())
  const sourceVisible = focused === true && isOnScreen(entry)
  // The chat it came from is on screen and already shows it: kept, but not an unread badge.
  if (sourceVisible) useNotificationsStore.getState().markRead(entry.id)
  const native = hint ? hint.native : true
  if (!native || !(deps.desktop ?? isDesktop)) return
  const preferences = notificationPreferences()
  const context: NotificationContext = {
    now: Date.now(),
    focused,
    sourceVisible,
    quiet: false,
    condition: preferences.condition,
  }
  const channels = notificationChannels(envelopeOf(entry), context, new Set(['native']))
  if (channels.has('native')) {
    ;(deps.notify ?? notifyDesktop)(
      entry.title,
      entry.message,
      preferences.condition,
      eventSignalKey(entry),
    )
  }
}

/** Run the policy for every row that opens live; returns the unsubscribe. */
export function startLiveInterruptions(deps: InterruptionDeps = {}): () => void {
  return onLiveRaise((entry) => interruptFor(entry, deps))
}
