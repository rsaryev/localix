/**
 * The answers of the mods' describing events — `tool.describe`, `prompt.section`,
 * `prompt.compose`, `prompt.context`, `prompt.attachment`, `command.describe` — kept per
 * conversation until a mod calls `$.ui.invalidate(event)`, as Claude Code caches them for the
 * session. An unstable answer would otherwise rewrite the model's cached prompt on every request.
 *
 * A key is the conversation, the instances asked and what core answered: a core text that changes
 * asks the hooks again, an unchanged one reuses their answer.
 */

/** Answers kept per event; the oldest go first past it. */
const PER_EVENT = 512

/** What clearing an event clears too: a composed prompt is made of its sections. */
const CLEARS: Record<string, readonly string[]> = {
  'prompt.section': ['prompt.compose'],
  'attribution.text': ['prompt.compose'],
}

export function createAnswerCache(limit = PER_EVENT) {
  const byEvent = new Map<string, Map<string, Promise<unknown>>>()
  return {
    /** The kept answer for `key`, else `compute`'s, kept unless it fails. */
    through<T>(event: string, key: string, compute: () => Promise<T>): Promise<T> {
      let answers = byEvent.get(event)
      if (!answers) byEvent.set(event, (answers = new Map()))
      const kept = answers.get(key)
      if (kept) return kept as Promise<T>
      const answer = compute()
      answers.set(key, answer)
      answer.catch(() => answers.delete(key))
      if (answers.size > limit) answers.delete(answers.keys().next().value!)
      return answer
    },
    invalidate(event: string): void {
      for (const name of [event, ...(CLEARS[event] ?? [])]) byEvent.delete(name)
    },
  }
}

export type AnswerCache = ReturnType<typeof createAnswerCache>

/** A cache key from the parts of a question. */
export const answerKey = (...parts: readonly unknown[]): string => JSON.stringify(parts)
