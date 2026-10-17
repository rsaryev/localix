/**
 * THE SOURCES OF ATTENTION — each kind's seam, turned into items on the one registry.
 *
 * Each adapter keeps the interface its seam already calls (the HITL registry's `lifecycle`, the
 * handoff's mention and the turn entry's reply, the plans
 * service's lifecycle port), so moving the journal rows behind the registry changed no seam. What
 * an adapter decides is only the item: its key, its title, what it summarises. The item builders
 * for the durable kinds are exported because a boot rebuilds those items from their own rows
 * (`restoreDurableAttention`) — through the same builder, or a restored item would read
 * differently from the live one it replaces.
 */
import type { PlanRecord, SessionPlan } from '../plans/contracts'
import {
  hitlAttentionKey,
  mentionAttentionKey,
  mentionAttentionPrefix,
  planAttentionKey,
  planAttentionPrefix,
  type AttentionItem,
  type AttentionSettleReason,
} from './contracts'
import type { AttentionRegistry } from './registry'

// ---- interaction (the HITL registry's lifecycle) -----------------------------------------------

export interface HitlRaised {
  userId?: string
  /** The session where the prompt is rendered and answered. */
  sessionId: string
  requestId: string
  title?: string
  /** What `hitl.requested` carries, so the client can answer without loading the session. */
  interaction?: unknown
}

export interface HitlEnded {
  userId?: string
  requestId: string
  reason: Extract<AttentionSettleReason, 'answered' | 'dismissed' | 'expired' | 'cancelled'>
}

/** What `createHitlRegistry` accepts as its `lifecycle` option. */
export interface HitlLifecycleObserver {
  raised(request: HitlRaised): void
  ended(ending: HitlEnded): void
}

export function hitlAttention(
  registry: AttentionRegistry,
  defaultUserId: string,
  now: () => string = () => new Date().toISOString(),
): HitlLifecycleObserver {
  return {
    raised(request) {
      registry.raise(request.userId ?? defaultUserId, {
        key: hitlAttentionKey(request.requestId),
        kind: 'interaction',
        sessionId: request.sessionId,
        at: now(),
        title: request.title?.trim() || 'Agent needs your input',
        subject: { requestId: request.requestId },
        ...(request.interaction !== undefined ? { interaction: request.interaction } : {}),
      })
    },
    ended(ending) {
      registry.settle(
        ending.userId ?? defaultUserId,
        { key: hitlAttentionKey(ending.requestId) },
        ending.reason,
      )
    },
  }
}

// ---- mention (a board card assigned to the person) ----------------------------------------------

export interface UserMentioned {
  userId: string
  sessionId: string
  messageId: string
  /** Who asked, by handle ('' when the author has none). */
  from: string
  /** What they asked, already trimmed to a notice by the producer. */
  text?: string
  mentionedAt?: number
}

export interface MentionAttention {
  mentioned(mention: UserMentioned): void
  /** The person wrote in the conversation: whatever was asked of them there is answered. */
  answered(userId: string, sessionId: string): void
}

export function mentionAttention(registry: AttentionRegistry): MentionAttention {
  return {
    mentioned(mention) {
      const text = mention.text?.trim()
      // One waiting mention per conversation until the person writes there (`answered`): the
      // conversation is already flagged, and a second banner for it would only repeat the ping.
      const prefix = mentionAttentionPrefix(mention.sessionId)
      if (registry.list(mention.userId).some((item) => item.key.startsWith(prefix))) return
      registry.raise(mention.userId, {
        key: mentionAttentionKey(mention.sessionId, mention.messageId),
        kind: 'mention',
        sessionId: mention.sessionId,
        at: new Date(mention.mentionedAt ?? Date.now()).toISOString(),
        title: mention.from ? `@${mention.from} assigned you a card` : 'A card is assigned to you',
        ...(text ? { summary: text } : {}),
        subject: {
          messageId: mention.messageId,
          ...(mention.from ? { agentHandle: mention.from } : {}),
        },
      })
    },
    answered(userId, sessionId) {
      registry.settle(userId, { prefix: mentionAttentionPrefix(sessionId) }, 'answered')
    },
  }
}

// ---- plan (a version presented for review) ------------------------------------------------------

const EXCERPT_LINES = 6
const EXCERPT_MAX = 600

/** The plan's opening lines, bounded — enough to recognise it, never the whole document. */
const excerpt = (body: string): string => {
  const lines = body.trim().split('\n').slice(0, EXCERPT_LINES).join('\n')
  return lines.length > EXCERPT_MAX ? `${lines.slice(0, EXCERPT_MAX - 1).trimEnd()}…` : lines
}

export function planItem(
  plan: Pick<SessionPlan, 'id' | 'sessionId' | 'version' | 'title' | 'body' | 'createdAt'>,
  authorHandle: string | null,
): AttentionItem {
  return {
    key: planAttentionKey(plan.sessionId, plan.id),
    kind: 'plan',
    sessionId: plan.sessionId,
    at: plan.createdAt,
    title: `Plan v${plan.version}: ${plan.title}`,
    summary: excerpt(plan.body),
    subject: {
      planId: plan.id,
      version: plan.version,
      ...(authorHandle ? { agentHandle: authorHandle } : {}),
    },
  }
}

export interface PlanAttention {
  /** A version waits on the person; every older waiting version of the conversation is superseded. */
  awaiting(userId: string, plan: SessionPlan, authorHandle: string | null): void
  /** A version (or, with `null`, every version of the root) stopped waiting. */
  settled(
    userId: string,
    rootSessionId: string,
    planId: string | null,
    reason: AttentionSettleReason,
  ): void
}

export function planAttention(registry: AttentionRegistry): PlanAttention {
  return {
    awaiting(userId, plan, authorHandle) {
      registry.settle(userId, { prefix: planAttentionPrefix(plan.sessionId) }, 'superseded')
      registry.raise(userId, planItem(plan, authorHandle))
    },
    settled(userId, rootSessionId, planId, reason) {
      registry.settle(
        userId,
        planId === null
          ? { prefix: planAttentionPrefix(rootSessionId) }
          : { key: planAttentionKey(rootSessionId, planId) },
        reason,
      )
    },
  }
}

// ---- boot ---------------------------------------------------------------------------------------

/**
 * The durable kinds outlive the process, so the registry relearns them at boot from their rows:
 * the plans still waiting for review. HITL interactions do not — the HITL
 * registry is memory-only, and the boot sweep settles their journal rows (`restart`).
 */
export function restoreDurableAttention(
  registry: AttentionRegistry,
  sources: {
    plans: readonly PlanRecord[]
    /** The presenting participant's handle, by plan id — the live item names it too. */
    planAuthors?: ReadonlyMap<string, string>
  },
): void {
  const byUser = new Map<string, AttentionItem[]>()
  const add = (userId: string, item: AttentionItem) =>
    byUser.set(userId, [...(byUser.get(userId) ?? []), item])
  for (const plan of sources.plans)
    add(plan.userId, planItem(plan, sources.planAuthors?.get(plan.id) ?? null))
  for (const [userId, items] of byUser) registry.restore(userId, items)
}

/** The boot call: names each waiting plan's presenter from its root session, then restores. */
export async function rebuildDurableAttention(
  registry: AttentionRegistry,
  sources: {
    plans: readonly PlanRecord[]
    getSession: (
      userId: string,
      sessionId: string,
    ) => Promise<{ agents: readonly { agentId: string; handle: string }[] } | null>
  },
): Promise<void> {
  const planAuthors = new Map<string, string>()
  for (const plan of sources.plans) {
    const root = await sources.getSession(plan.userId, plan.sessionId).catch(() => null)
    const handle = root?.agents.find((member) => member.agentId === plan.authorAgentId)?.handle
    if (handle) planAuthors.set(plan.id, handle)
  }
  restoreDurableAttention(registry, { ...sources, planAuthors })
}
