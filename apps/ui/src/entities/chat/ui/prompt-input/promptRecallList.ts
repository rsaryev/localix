// Pure builder for the composer's prompt-recall list. Extracts THIS session's
// previously-sent user prompts (skipping internal messages, collapsing immediate
// repeats) and merges them — most recent first — with the GLOBAL cross-session
// history, de-duped (newest occurrence wins), then ordered oldest→newest (the order
// recall walks backward from). Split out of usePromptHistory so it's testable
// without the store / localStorage.

interface RecallMessage {
  role: string
  isInternal?: boolean
  content?: string | null
}

export function buildPromptRecallList(
  messages: ReadonlyArray<RecallMessage>,
  globalHistory: readonly string[],
): string[] {
  // Session prompts, oldest→newest, immediate repeats collapsed.
  const session: string[] = []
  for (const m of messages) {
    if (m.role !== 'user' || m.isInternal) continue
    const text = m.content?.trim()
    if (text && text !== session[session.length - 1]) session.push(text)
  }
  // Merge newest-first (this session first — most relevant — then global), de-dupe
  // keeping the newest occurrence, then flip back to oldest→newest.
  const seen = new Set<string>()
  const newestFirst: string[] = []
  for (const text of [...session.slice().reverse(), ...globalHistory]) {
    if (seen.has(text)) continue
    seen.add(text)
    newestFirst.push(text)
  }
  return newestFirst.reverse()
}
