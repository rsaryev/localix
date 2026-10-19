import {
  isSystemContextSelectionBinding,
  latestSystemContextBindings,
  selectedSystemContextTokens,
  type MessageContextBinding,
} from '@localixai/agent'

import type { StoredSystemNotice } from '../../db/payload'
import type { PersistedMessage } from './contracts'

const SYSTEM_EVENT_KIND = 'system-event'
const SYSTEM_PROVIDER_ID = 'localix.system'
const SYSTEM_PROVIDER_VERSION = '1'

function eventKey(notice: StoredSystemNotice): string {
  if (
    notice.kind === 'run_failed' ||
    notice.kind === 'run_interrupted' ||
    notice.kind === 'turn_limit' ||
    // A status, not a lasting fact: the next turn's outcome supersedes it.
    notice.kind === 'handoff_limit'
  ) {
    return 'run:latest-status'
  }
  // One plan, one current step: "v2 approved" supersedes "v2 presented" in the model's context,
  // or the tail would still say a plan waits for review while the agent implements it. Keyed
  // before the participant rule below.
  if (notice.kind.startsWith('plan_')) return 'plan:latest-status'
  if (notice.kind === 'permission_mode_change') return 'session:permission-mode'
  if (notice.kind === 'conversation_mode_change') return 'session:conversation-mode'
  return notice.participant
    ? `notice:${notice.kind}:participant:${notice.participant.toLocaleLowerCase()}`
    : `notice:${notice.kind}`
}

/**
 * Capture a host-authored notice through the same resolved context-binding contract as every
 * other piece of model context. The visible row stays UI-only; this binding is its durable,
 * typed model-facing value.
 */
export function systemNoticeBinding(
  notice: StoredSystemNotice,
  messageId: string,
  capturedAt: string,
): MessageContextBinding {
  const key = eventKey(notice)
  return {
    kind: 'context',
    id: `system-event:${messageId}`,
    source: 'system',
    target: {
      kind: SYSTEM_EVENT_KIND,
      token: key,
      label: notice.text,
      attributes: { noticeKind: notice.kind },
    },
    resolution: {
      status: 'resolved',
      capturedAt,
      contributions: [
        {
          id: key,
          providerId: SYSTEM_PROVIDER_ID,
          providerVersion: SYSTEM_PROVIDER_VERSION,
          scope: 'session',
          kind: SYSTEM_EVENT_KIND,
          content: notice.text,
          sensitivity: 'public',
        },
      ],
    },
  }
}

function isSystemEventBinding(binding: unknown): binding is MessageContextBinding {
  return (
    typeof binding === 'object' &&
    binding !== null &&
    (binding as MessageContextBinding).kind === 'context' &&
    (binding as MessageContextBinding).source === 'system' &&
    (binding as MessageContextBinding).target?.kind === SYSTEM_EVENT_KIND
  )
}

/**
 * Reduce the system event log to bindings for the facts that are true now.
 *
 * Event-like notices share semantic keys and retain only the newest value. Legacy rows without
 * bindings are upgraded through the same constructor. A persisted selection binding applies the
 * user's enable/disable choices without introducing a parallel context channel.
 */
export function currentSystemContextBindings(
  messages: readonly PersistedMessage[],
): MessageContextBinding[] {
  const eventMessages = messages.map((message) => {
    const notice = message.payload.systemNotice
    const stored = (message.payload.bindings ?? []).find(isSystemEventBinding)
    const binding =
      stored ?? (notice ? systemNoticeBinding(notice, message.id, message.createdAt) : undefined)
    return {
      role: message.payload.role,
      ...(binding ? { bindings: [binding] } : {}),
    }
  })
  const selected = [...messages]
    .reverse()
    .flatMap((message) => message.payload.bindings ?? [])
    .find(
      (binding): binding is MessageContextBinding =>
        binding.kind === 'context' && isSystemContextSelectionBinding(binding),
    )
  const selectedTokens = selectedSystemContextTokens(selected)
  const current = latestSystemContextBindings(eventMessages)
  return selectedTokens === null
    ? current
    : current.filter((binding) => selectedTokens.has(binding.target.token))
}
