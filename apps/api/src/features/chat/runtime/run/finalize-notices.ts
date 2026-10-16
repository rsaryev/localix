/**
 * WHAT THE SYSTEM SAYS ABOUT A RUN THAT DID NOT FINISH.
 *
 * Two endings need a line, and neither may be written in the model's voice: the finalizer
 * fabricates nothing under an agent's name, and a paragraph appearing under one IS its voice
 * however it is worded. Both used to be written INTO the assistant row, which is how a raw
 * upstream body — `403: {"message":"Key limit exceeded (daily limit)…"}` — came to render as
 * the agent's own reply.
 *
 * A row of its own says it as the system, carries the recovery as a control rather than as an
 * instruction in prose, and lets the KIND decide who reads it
 * (`chat/system-notice-audience.ts`): a failed attempt is a fact the next run needs, because
 * without it half-finished work in the transcript reads as somebody's completed turn.
 *
 * Here rather than in `finalize.ts` because it is what the finalizer SAYS rather than what it
 * does, and because that file is at the size this repository lets one reach.
 */
import type { PresentedError } from '@localixai/agent/agents'

import { insertUiNote } from '../message-persistence'
import type { RunEnv } from './types'

interface NoticeTarget {
  env: RunEnv
  userId: string
  sessionId: string
  /** The reply the line is about; its id keys the row so a repeated finalizer cannot stack. */
  assistantMessageId: string
}

/** The run stopped on a brake of its own — the person's turn limit. */
export async function announceRunStopped(target: NoticeTarget, text: string): Promise<void> {
  await write(target, 'turn-limit', {
    kind: 'turn_limit',
    tone: 'neutral',
    text,
    recovery: ['retry'],
  })
}

/** The run produced nothing at all — no text, no tool call. Said as the system, never as the agent. */
export async function announceEmptyReply(target: NoticeTarget): Promise<void> {
  await announceRunFailure(target, {
    headline: 'No reply',
    reason: 'The agent ended its turn without a reply.',
    severity: 'warning',
    actions: ['retry'],
  })
}

/**
 * The run failed, as `presentErrorInfo` worded it. The presentation decides the CONTROLS, not
 * whether anything is said: a person left with a failed bubble and no reason is the defect, and
 * a Retry for a spent daily quota is a promise it cannot keep — that failure offers the
 * provider settings instead. The tone matches the Event Center's: `error` when trying again
 * cannot help, so one failure does not read amber here and red there. The text is the reason
 * alone; "Trying again may work." was prose standing in for the button beside it.
 */
export async function announceRunFailure(
  target: NoticeTarget,
  presented: PresentedError,
): Promise<void> {
  await write(target, 'failed', {
    kind: 'run_failed',
    tone: presented.severity,
    text: presented.reason,
    ...(presented.detail ? { detail: presented.detail } : {}),
    ...(presented.actions.length ? { recovery: presented.actions } : {}),
  }).catch(() => undefined)
}

function write(
  target: NoticeTarget,
  suffix: string,
  notice: Parameters<typeof insertUiNote>[0]['systemNotice'],
): Promise<unknown> {
  return insertUiNote({
    repo: target.env.repo,
    streamRegistry: target.env.deps.streamRegistry,
    now: () => new Date().toISOString(),
    userId: target.userId,
    sessionId: target.sessionId,
    // Derived from the reply it is about, so a repeat of this finalizer — a retried segment, a
    // racing writer — lands on the same row instead of stacking a second identical line.
    messageId: `${target.assistantMessageId}:${suffix}`,
    content: notice?.text ?? '',
    ...(notice ? { systemNotice: notice } : {}),
  })
}
