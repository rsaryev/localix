import type { NotificationAction, NotificationEnvelope, NotificationEvent } from './contracts'

const RUN_TTL_MS = 10 * 60_000
const HITL_TTL_MS = 60 * 60_000
const DEFAULT_DEDUPE_MS = 30_000
let sequence = 0

export type AgentNotificationTrigger =
  | {
      type: 'run.completed' | 'run.failed'
      sessionId: string
      /** Stable id of this run (the assistant message id on the realtime wire). */
      runId?: string
      projectId?: string | null
      sessionTitle?: string
      error?: string
    }
  | {
      type: 'hitl.required'
      sessionId: string
      projectId?: string | null
      sessionTitle?: string
      requestId: string
      requestTitle?: string
      /** When the request stops accepting an answer (epoch ms); it caps the interruption. */
      expiresAt?: number
    }
  | {
      type: 'user.mentioned'
      sessionId: string
      projectId?: string | null
      sessionTitle?: string
      /** The row the question is on — its identity, so a re-published frame is one row. */
      messageId: string
      /** Who asked, by handle. */
      from: string
      /** What they asked, already trimmed by the producer. */
      text?: string
    }
  | {
      type: 'child.completed' | 'child.failed' | 'child.stopped'
      sessionId: string
      /**
       * Which run of the child ended. A child session runs more than once (a sub-agent resumed
       * with a follow-up, a job re-run), and a key without it dropped the second ending as a
       * replay of the first.
       */
      runId?: string
      projectId?: string | null
      sessionTitle?: string
    }
  | {
      type: 'terminal.finished'
      sessionId: string
      terminalId: string
      exitCode: number
      projectId?: string | null
      sessionTitle?: string
      command?: string
    }

function deepLink(sessionId: string): NotificationAction {
  return {
    id: 'open',
    label: 'Open',
    kind: 'open_deep_link',
    uri: `localix://session/${encodeURIComponent(sessionId)}`,
  }
}

type AgentSource = Extract<NotificationEvent['source'], { sessionId: string }>

/** Which agent surface a trigger came from, and the domain resource it is about. */
function sourceOf(trigger: AgentNotificationTrigger): Pick<AgentSource, 'kind' | 'resource'> {
  switch (trigger.type) {
    case 'hitl.required':
      return { kind: 'agent_hitl', resource: { kind: 'interaction', id: trigger.requestId } }
    case 'user.mentioned':
      return { kind: 'agent_mention', resource: { kind: 'message', id: trigger.messageId } }
    case 'terminal.finished':
      return { kind: 'background_terminal', resource: { kind: 'terminal', id: trigger.terminalId } }
    case 'child.completed':
    case 'child.failed':
    case 'child.stopped':
      return { kind: 'agent_child', resource: undefined }
    case 'run.completed':
    case 'run.failed':
      return {
        kind: 'agent_run',
        resource: trigger.runId ? { kind: 'run', id: trigger.runId } : undefined,
      }
  }
}

/** Normalize run/HITL lifecycle facts into the shared domain envelope. */
export function agentNotificationEnvelope(
  trigger: AgentNotificationTrigger,
  occurredAt = Date.now(),
): NotificationEnvelope {
  const source = {
    ...sourceOf(trigger),
    sessionId: trigger.sessionId,
    projectId: trigger.projectId,
  }
  let event: NotificationEvent
  if (trigger.type === 'hitl.required') {
    event = {
      topic: trigger.type,
      // Waits on the person — the policy's `needsReaction` reads this, not the topic.
      category: 'human-input',
      severity: 'warning',
      title: trigger.requestTitle?.trim() || 'Agent needs your input',
      body: trigger.sessionTitle,
      source,
      persistence: 'durable',
      actions: [
        deepLink(trigger.sessionId),
        {
          id: 'respond',
          label: 'Respond',
          kind: 'respond_hitl',
          sessionId: trigger.sessionId,
          requestId: trigger.requestId,
        },
      ],
      dedupeKey: `${trigger.type}:${trigger.sessionId}:${trigger.requestId}`,
      dedupeWindowMs: DEFAULT_DEDUPE_MS,
      // Never past the request's own deadline: a banner for a question that has already expired
      // asks the person for an answer nothing will accept.
      ttlMs:
        trigger.expiresAt === undefined
          ? HITL_TTL_MS
          : Math.max(0, Math.min(HITL_TTL_MS, trigger.expiresAt - occurredAt)),
    }
  } else if (trigger.type === 'user.mentioned') {
    // Warning, like HITL, and for the same reason: it is the one thing in this file that is
    // waiting on the person rather than reporting to them. `needsReaction` in the policy reads
    // exactly that distinction (its `human-input` category) to decide whether a banner is
    // warranted.
    //
    // Titled with WHO asked, because in a room that is the first thing worth knowing, and
    // bodied with the question itself rather than the session title — a banner that says only
    // "you were mentioned" makes the person open the app to find out whether it mattered.
    event = {
      topic: trigger.type,
      category: 'human-input',
      severity: 'warning',
      title: trigger.from ? `@${trigger.from} assigned you a card` : 'A card is assigned to you',
      body: trigger.text?.trim() || trigger.sessionTitle,
      source,
      persistence: 'durable',
      actions: [deepLink(trigger.sessionId)],
      // Keyed to the MESSAGE: one question is one row however many times the frame is
      // replayed, and a second question later is a second row.
      dedupeKey: `${trigger.type}:${trigger.sessionId}:${trigger.messageId}`,
      dedupeWindowMs: DEFAULT_DEDUPE_MS,
      // The same hour HITL gets. A question addressed to a person by name does not stop
      // mattering in ten minutes, which is what the run TTL is for.
      ttlMs: HITL_TTL_MS,
    }
  } else if (trigger.type === 'terminal.finished') {
    const failed = trigger.exitCode !== 0
    event = {
      topic: trigger.type,
      severity: failed ? 'error' : 'success',
      title: failed
        ? `Background terminal exited (${trigger.exitCode})`
        : 'Background terminal finished',
      body: trigger.command?.trim() || trigger.sessionTitle,
      source,
      persistence: 'durable',
      actions: [deepLink(trigger.sessionId)],
      dedupeKey: `${trigger.type}:${trigger.sessionId}:${trigger.terminalId}`,
      dedupeWindowMs: RUN_TTL_MS,
      ttlMs: RUN_TTL_MS,
    }
  } else if (
    trigger.type === 'child.completed' ||
    trigger.type === 'child.failed' ||
    trigger.type === 'child.stopped'
  ) {
    event = {
      topic: trigger.type,
      // A stop is neither a success nor a failure, and someone chose it: `info` keeps it in the
      // record without the policy ever treating it as worth an interruption.
      severity:
        trigger.type === 'child.failed'
          ? 'error'
          : trigger.type === 'child.stopped'
            ? 'info'
            : 'success',
      title:
        trigger.type === 'child.failed'
          ? 'Sub-agent failed'
          : trigger.type === 'child.stopped'
            ? 'Sub-agent stopped'
            : 'Sub-agent finished',
      body: trigger.sessionTitle,
      source,
      persistence: 'durable',
      actions: [deepLink(trigger.sessionId)],
      dedupeKey: `${trigger.type}:${trigger.sessionId}:${trigger.runId ?? 'unscoped'}`,
      dedupeWindowMs: RUN_TTL_MS,
      ttlMs: RUN_TTL_MS,
    }
  } else {
    const failed = trigger.type === 'run.failed'
    event = {
      topic: trigger.type,
      severity: failed ? 'error' : 'success',
      title: failed ? 'Agent run failed' : 'Agent run finished',
      body: failed ? trigger.error || trigger.sessionTitle : trigger.sessionTitle,
      source,
      persistence: 'durable',
      actions: failed
        ? [
            deepLink(trigger.sessionId),
            {
              id: 'retry',
              label: 'Retry',
              kind: 'retry_run',
              sessionId: trigger.sessionId,
              ...(trigger.runId ? { runId: trigger.runId } : {}),
            },
          ]
        : [deepLink(trigger.sessionId)],
      dedupeKey: `${trigger.type}:${trigger.sessionId}:${
        ('runId' in trigger ? trigger.runId : undefined) ?? 'unscoped'
      }`,
      dedupeWindowMs: DEFAULT_DEDUPE_MS,
      ttlMs: RUN_TTL_MS,
    }
  }

  sequence += 1
  return {
    id: `${event.dedupeKey}:${occurredAt.toString(36)}:${sequence.toString(36)}`,
    occurredAt,
    event,
  }
}

// The APPLICATION-level envelopes — what the app reports about itself — live in
// `application-events.ts`. They join the same journal and the same policy, and they are built
// from a severity and a sentence rather than from the trigger union above, which is why a reader
// of "how is a run reported" no longer scrolls past them to get here.
