/**
 * THE TURN'S RUNTIME CONTEXT — what the model is told about the environment on one turn, sent
 * once, where the turn starts, and never rewritten.
 *
 * It used to be an ephemeral message rebuilt on every turn and dropped on the next. That is an
 * edit of history the model already saw: the provider's prefix cache broke at that message, and
 * on models with preserved thinking every thinking block after it was invalidated (Anthropic
 * drops them silently under `drop_block`). So the context is persisted on the run that sent it
 * and replayed in place; and because a persisted context accumulates, a turn carries only what
 * CHANGED — the `state` sections whose text differs from the agent's previous context — plus the
 * `turn` sections that belong to it alone. The first turn of every view (a fresh conversation,
 * after `/clear` or a topic change, at each checkpoint) renders everything.
 *
 * The rendered `content` is stored, not re-rendered: a renderer change must not rewrite a turn
 * that was already sent. `changes` is kept beside it only so the next turn can diff.
 */
import type { MessageContextBinding } from '@localixai/agent'

import type { RuntimeSection } from '../../../agent-core/system-prompt-tail'

export interface StoredTurnContext {
  /** A complete render: the state is exactly `changes`, whatever came before. */
  full?: true
  /** State sections this context set (text) or cleared (null). */
  changes: Record<string, string | null>
  /** The model-facing text, exactly as sent. */
  content: string
  /** System-event context bindings first delivered with this turn. */
  bindings?: MessageContextBinding[]
}

/** The standing state an agent's runtime context has established, section by section. */
export type TurnContextState = ReadonlyMap<string, string>

/** Fold an agent's contexts, oldest first, into the state the latest one leaves. */
export function turnContextState(contexts: readonly StoredTurnContext[]): TurnContextState {
  const state = new Map<string, string>()
  for (const context of contexts) {
    if (context.full) state.clear()
    for (const [key, text] of Object.entries(context.changes)) {
      if (text === null) state.delete(key)
      else state.set(key, text)
    }
  }
  return state
}

/** A removed section is named by its own heading, so the model knows which fact went away. */
const headingOf = (text: string) => text.split('\n', 1)[0]!.trim()

function render(
  full: boolean,
  changed: readonly string[],
  removed: readonly string[],
  turnTexts: readonly string[],
): string {
  const parts: string[] = []
  if (changed.length > 0 || removed.length > 0) {
    parts.push(
      [
        full ? '<runtime-context>' : '<runtime-context update>',
        ...changed,
        ...removed.map((heading) => `${heading}\n(no longer present)`),
        '</runtime-context>',
      ].join('\n\n'),
    )
  }
  parts.push(...turnTexts)
  return parts.join('\n\n')
}

export interface ComposeTurnContextInput {
  sections: readonly RuntimeSection[]
  bindings: readonly MessageContextBinding[]
  /** The agent's standing state before this turn; undefined starts a fresh view (full). */
  previous: { state: TurnContextState; bindingIds: ReadonlySet<string> } | undefined
}

/** This turn's context, or undefined when it has nothing to say. */
export function composeTurnContext(input: ComposeTurnContextInput): StoredTurnContext | undefined {
  const full = input.previous === undefined
  const before = input.previous?.state ?? new Map<string, string>()
  const current = new Map<string, string>()
  const turnTexts: string[] = []
  for (const section of input.sections) {
    if (section.scope === 'turn') turnTexts.push(section.text)
    else current.set(section.key, section.text)
  }

  const changes: Record<string, string | null> = {}
  const changed: string[] = []
  for (const [key, text] of current) {
    if (!full && before.get(key) === text) continue
    changes[key] = text
    changed.push(text)
  }
  const removed: string[] = []
  if (!full) {
    for (const [key, text] of before) {
      if (current.has(key)) continue
      changes[key] = null
      removed.push(headingOf(text))
    }
  }
  const bindings = input.bindings.filter(
    (binding) => full || !input.previous!.bindingIds.has(binding.id),
  )

  const content = render(full, changed, removed, turnTexts)
  if (!content && bindings.length === 0) return undefined
  return {
    ...(full ? { full: true as const } : {}),
    changes,
    content,
    ...(bindings.length > 0 ? { bindings } : {}),
  }
}
