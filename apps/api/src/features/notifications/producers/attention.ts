import type { AttentionItem, AttentionKind } from '../../attention/contracts'
import type { AttentionRegistry } from '../../attention/registry'
import type { NotificationSeverity, NotificationTopic } from '@localixai/notifications'
import type { InboxAction } from '../contracts'
import type { NotificationJournal } from '../journal'
import {
  openChatAction,
  resourceOrigin,
  unknownSession,
  type LookupSession,
  type OrderedLane,
  type SessionFacts,
} from './facts'

/**
 * EVERY "WAITING ON YOU" ITEM AS ONE EVENT CENTER ROW — the journal side of the attention
 * registry (`features/attention`).
 *
 * There used to be a producer per kind (a HITL request, a mention), each building its row
 * its own way; a plan waiting for review would have been a third. The registry
 * is now the one place an item is raised and settled, and this observer is the one place it
 * becomes a row: the item's key is the row's key (so the rows written before the registry, and
 * the boot sweep's `hitl:` prefix, keep their meaning), its settle reason is the row's.
 *
 * Through the shared ordered lane, like every producer: a raise looks the session up first, and a
 * settle recorded a tick later must not overtake it and leave the row open for something answered.
 */

interface RowShape {
  topic: NotificationTopic
  severity: NotificationSeverity
  label: string
  resourceId: (item: AttentionItem) => string
  title: (item: AttentionItem) => string
  body: (item: AttentionItem, session: SessionFacts) => string | undefined
  /** The answering action beside "Open chat", where the kind is answered in place. */
  focus?: (item: AttentionItem) => Pick<InboxAction, 'id' | 'label' | 'requestId'>
}

const ROW: Record<AttentionKind, RowShape> = {
  // The agent is BLOCKED on it, and it may expire: a warning.
  interaction: {
    topic: 'hitl.required',
    severity: 'warning',
    label: 'Agent',
    resourceId: (item) => item.subject.requestId ?? item.key,
    title: (item) => item.title,
    body: (_item, session) => session.title,
    focus: (item) => ({
      id: 'respond',
      label: 'Respond',
      ...(item.subject.requestId ? { requestId: item.subject.requestId } : {}),
    }),
  },
  mention: {
    topic: 'user.mentioned',
    severity: 'warning',
    label: 'Mention',
    resourceId: (item) => item.subject.messageId ?? item.key,
    title: (item) => item.title,
    body: (item, session) => item.summary || session.title,
  },
  // Plan mode stops the work at the plan: until the person decides, nothing is implemented.
  plan: {
    topic: 'hitl.required',
    severity: 'warning',
    label: 'Plan',
    resourceId: (item) => item.subject.planId ?? item.key,
    title: (item) =>
      item.subject.agentName
        ? `${item.subject.agentName} presented a plan`
        : 'A plan is waiting for your review',
    body: (item) => item.title,
    focus: () => ({ id: 'review', label: 'Review plan' }),
  },
}

export function mirrorAttentionToJournal(deps: {
  registry: Pick<AttentionRegistry, 'observe'>
  journal: NotificationJournal
  lane: OrderedLane
  lookupSession: LookupSession
}): () => void {
  const { journal, lane, lookupSession } = deps
  return deps.registry.observe({
    raised(userId, item) {
      lane.run(async () => {
        const session =
          (await lookupSession(userId, item.sessionId).catch(() => null)) ??
          unknownSession(item.sessionId)
        const shape = ROW[item.kind]
        const open = openChatAction(session)
        const focus = shape.focus?.(item)
        const body = shape.body(item, session)
        const occurredAt = Date.parse(item.at)
        journal.record(userId, {
          key: item.key,
          topic: shape.topic,
          category: 'human-input',
          severity: shape.severity,
          title: shape.title(item),
          ...(body ? { body } : {}),
          origin: resourceOrigin(session, item.kind, shape.resourceId(item), shape.label),
          actions: focus
            ? [
                open,
                {
                  ...focus,
                  kind: 'navigate',
                  target: { ...open.target!, focus: 'interaction' },
                  available: true,
                },
              ]
            : [open],
          ...(Number.isFinite(occurredAt) ? { occurredAt } : {}),
        })
      })
    },
    settled(userId, target, reason) {
      lane.run(() => journal.settle(userId, { ...target, reason }))
    },
  })
}
