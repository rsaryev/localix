/** Metadata-only timing entries appear in the browser Performance panel, never containing drafts. */
export function recordInlineAssistMetric(
  surface: 'input' | 'editor',
  outcome: string,
  durationMs = 0,
): void {
  if (typeof performance === 'undefined' || typeof performance.measure !== 'function') return
  const name = `localix.inline-assist.${surface}`
  try {
    performance.measure(name, {
      start: performance.now() - Math.max(0, durationMs),
      duration: Math.max(0, durationMs),
      detail: { outcome },
    })
    // Speculative calls can be frequent; keep the browser's timing buffer bounded.
    if (performance.getEntriesByName(name).length > 200) performance.clearMeasures(name)
  } catch {
    // Instrumentation must never interrupt editing in runtimes without User Timing L3.
  }
}
