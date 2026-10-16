import type { AgentTool } from './types'

/**
 * WHAT ONE CALL REACHES, from least to most consequential.
 *
 * A read/write bit could not tell a read-only session which writes are harmless: a game move,
 * a board card and a question queued for later are writes, and refusing them made planning
 * unusable, while letting "writes" through let `DROP TABLE` in. The line a session mode draws
 * is about WHERE the effect lands, so that is what a call declares.
 *
 * - `read`      observes; changes nothing anywhere (a network GET of public data included).
 * - `view`      ephemeral UI the person is looking at: a chart drawing, a camera move, a pane.
 * - `session`   state owned by this conversation and deleted with it: a board card, a game, a
 *               queued question, a child session it delegates to.
 * - `files`     files on disk — the workspace or anywhere a path rule can judge.
 * - `host`      the agent's own durable state beyond this conversation: global memory, skills,
 *               loops and triggers, plugins, configuration, secrets.
 * - `external`  everything past the machine's edge or past prediction: processes, remote data,
 *               network side effects, messages, money. The answer for an unknown call.
 */
export type CallEffect = 'read' | 'view' | 'session' | 'files' | 'host' | 'external'

/** Effects that change nothing durable — what "this call mutates" is the negation of. */
export const NON_MUTATING_EFFECTS: readonly CallEffect[] = ['read', 'view']

export interface CallClass {
  effect: CallEffect
  /** Cannot be undone: a delete, a `DROP`, a kill, a sent message. */
  irreversible?: boolean
  /** Waits on a person — a card, masked input, a question. Unanswerable when nobody is there. */
  needsHuman?: boolean
}

/**
 * The class of a call whose tool declares no {@link AgentTool.classify}: its static flag, read
 * fail-closed. `mutates: false` is a statement and reads as `read`; `true` says it writes but
 * not where, and silence says nothing at all — both are `external`, the widest answer, because
 * a classification is a permission input and an undeclared one must not open a door.
 */
export function classifyByFlag(tool: Pick<AgentTool, 'mutates'> | undefined): CallClass {
  return tool?.mutates === false ? { effect: 'read' } : { effect: 'external' }
}

/** One call's class: the tool's own answer when it gives one, else {@link classifyByFlag}. */
export function classifyToolCall(
  tool: Pick<AgentTool, 'mutates' | 'classify'> | undefined,
  input: unknown,
): CallClass {
  return tool?.classify ? tool.classify(input) : classifyByFlag(tool)
}
