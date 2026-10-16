import type { NextEditOutcome } from '../edit-prediction/contracts'

/**
 * Baseline telemetry is opt-in and metadata-only. It intentionally uses no database
 * persistence until retention/consent policy is specified; production hosts may
 * replace this sink with their telemetry exporter.
 */
export function createNextEditTelemetry(enabled: boolean): (event: NextEditOutcome) => void {
  if (!enabled) return () => {}
  return (event) =>
    console.info(
      '[edit-prediction]',
      JSON.stringify({
        event: 'outcome',
        ...event,
      }),
    )
}
