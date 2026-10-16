/**
 * A lazy loader that runs once and remembers its success — but not its failure.
 *
 * The UI's lazy chunks (the math typesetter, the diagram engine) were loaded through a module
 * `let loading: Promise | null`, which cached a rejection just as faithfully as a result: one
 * failed chunk fetch — an app updated under a running window, a dev server re-optimizing a new
 * dependency — left the feature dead for the rest of the session. A failure here clears the
 * slot, so the next caller retries, while concurrent callers still share one request.
 */
export function loadOnce<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null
  return () => {
    pending ??= load().catch((error: unknown) => {
      pending = null
      throw error
    })
    return pending
  }
}
