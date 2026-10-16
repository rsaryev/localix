import { installReactPerformanceCleanup } from '@/shared/lib/reactPerformanceCleanup'

if (
  import.meta.env.DEV &&
  typeof performance !== 'undefined' &&
  typeof performance.measure === 'function'
) {
  // Also release the old unbounded buffer when this guard first arrives through Fast Refresh.
  // This only discards development diagnostics, never application state or active marks.
  performance.clearMeasures()
  const dispose = installReactPerformanceCleanup(performance)
  import.meta.hot?.dispose(dispose)
}
