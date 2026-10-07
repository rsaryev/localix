/** React's development tracks retain cloned props in the browser's User Timing buffer. */
function isReactMeasure(options: string | PerformanceMeasureOptions | undefined): boolean {
  if (!options || typeof options !== 'object') return false
  const devtools = options.detail?.devtools
  return devtools?.track === 'Components ⚛' || devtools?.trackGroup === 'Scheduler ⚛'
}

/**
 * Recording tools still receive User Timing entries, but the page must not keep every render's
 * cloned props for its entire lifetime. Clear React entries as they are emitted; application
 * measurements and the entry returned to the caller remain available.
 */
export function installReactPerformanceCleanup(
  timeline: Pick<Performance, 'measure' | 'clearMeasures'>,
): () => void {
  const original = timeline.measure
  const measure: typeof original = function (name, startOrOptions, endMark) {
    const entry = original.call(timeline, name, startOrOptions, endMark)
    if (isReactMeasure(startOrOptions)) timeline.clearMeasures(name)
    return entry
  }
  timeline.measure = measure
  return () => {
    // A newer installer must not be undone by an older HMR cleanup.
    if (timeline.measure === measure) timeline.measure = original
  }
}
