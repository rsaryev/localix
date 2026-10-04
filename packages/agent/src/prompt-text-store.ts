/**
 * The text behind a prompt-cache hash, kept only long enough to explain a cache miss.
 *
 * The cache snapshot already reports which part of the prompt CHANGED between two turns —
 * `previous.changed` names the fields, e.g. `stablePrefixHash`. What it cannot say is what
 * changed inside them, and that is the whole question: a stable prefix that moves every turn
 * means the provider re-caches the entire system+tools prefix every turn, which is the single
 * most expensive quiet regression this system has. "The prefix changed" points at it; only the
 * text says which token did it.
 *
 * Content-addressed, so it deduplicates by construction: the same prompt hashes to the same
 * key from every turn and every session that shares it, and a session whose prefix is stable
 * stores exactly one copy of it.
 *
 * PROCESS-LOCAL and bounded, deliberately. Prompt text carries whatever the user put in front
 * of the model — project instructions, memory, file content — so it is not something to write
 * to disk for a diagnostic. It survives as long as the process that produced it, which is as
 * long as the question "why did that turn miss" stays live. A restart answers "I no longer
 * know", which is a better answer than a durable copy of everyone's prompts.
 */

export interface PromptTextStore {
  /** Remember `text` under `hash`. Idempotent: the hash IS the identity. */
  put(hash: string, text: string): void
  get(hash: string): string | undefined
  /** Entries currently retained — for diagnostics about the diagnostics. */
  size(): number
}

export interface PromptTextStoreOptions {
  /** Distinct texts retained; oldest evicted first. */
  maxEntries?: number
  /** A single text longer than this is not retained at all — see `put`. */
  maxTextChars?: number
}

/**
 * Defaults sized for the question, not for completeness: a handful of turns of history is
 * enough to diff the current prefix against the one before it, and a prompt far past the cap
 * is one nobody is going to read as a diff anyway.
 */
const DEFAULT_MAX_ENTRIES = 64
const DEFAULT_MAX_TEXT_CHARS = 1_000_000

export function createPromptTextStore(options: PromptTextStoreOptions = {}): PromptTextStore {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
  const maxTextChars = options.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS
  const byHash = new Map<string, string>()

  return {
    put(hash, text) {
      if (!hash) return
      // Refusing an oversized text is better than truncating one: a truncated prompt diffed
      // against a whole one produces a difference that is an artefact of this store, and a
      // diagnostic that invents differences is worse than one that says nothing.
      if (text.length > maxTextChars) return
      // Re-insert so recency is insertion order — the same LRU shape the composition store
      // uses, and the reason `delete` precedes `set`.
      byHash.delete(hash)
      byHash.set(hash, text)
      while (byHash.size > maxEntries) {
        const oldest = byHash.keys().next().value
        if (oldest === undefined) break
        byHash.delete(oldest)
      }
    },
    get(hash) {
      const text = byHash.get(hash)
      if (text === undefined) return undefined
      // A read is a use: diffing the same prefix across many turns should keep it alive.
      byHash.delete(hash)
      byHash.set(hash, text)
      return text
    },
    size: () => byHash.size,
  }
}
