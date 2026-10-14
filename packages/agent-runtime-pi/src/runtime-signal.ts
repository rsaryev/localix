/** Relay external cancellation and remove only the listener owned by this run. */
export function mergeSignals(
  controller: AbortController,
  external?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  if (!external) return { signal: controller.signal, cleanup: () => {} }
  if (external.aborted) controller.abort(external.reason)
  const relay = () => controller.abort(external.reason)
  if (!external.aborted) external.addEventListener('abort', relay, { once: true })
  return {
    signal: controller.signal,
    cleanup: () => external.removeEventListener('abort', relay),
  }
}
