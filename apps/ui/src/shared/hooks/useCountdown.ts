import { useEffect, useState } from 'react'

export interface CountdownLabels {
  /** Shown when the target is null (no active countdown). Default: "idle". */
  whenIdle?: string
  /** Shown once the target is reached or passed. Default: "soon". */
  whenElapsed?: string
}

function countdownTargetMs(isoTarget: string | null): number | null {
  if (!isoTarget) return null
  const targetMs = new Date(isoTarget).getTime()
  return Number.isFinite(targetMs) ? targetMs : null
}

/** Format the time remaining until `isoTarget` as "in 4m 12s" / "in 30s". */
export function formatCountdown(isoTarget: string | null, labels: CountdownLabels = {}): string {
  const targetMs = countdownTargetMs(isoTarget)
  if (targetMs === null) return labels.whenIdle ?? 'idle'
  const diffMs = targetMs - Date.now()
  if (diffMs <= 0) return labels.whenElapsed ?? 'soon'

  const totalSec = Math.floor(diffMs / 1000)
  const mins = Math.floor(totalSec / 60)
  const secs = totalSec % 60
  return mins === 0 ? `in ${secs}s` : `in ${mins}m ${secs}s`
}

/** Live 1Hz countdown to a future ISO timestamp; re-renders each second. */
export function useCountdown(isoTarget: string | null, labels: CountdownLabels = {}): string {
  const { whenIdle, whenElapsed } = labels
  const [label, setLabel] = useState(() => formatCountdown(isoTarget, labels))

  useEffect(() => {
    const opts = { whenIdle, whenElapsed }
    const tick = () => setLabel(formatCountdown(isoTarget, opts))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [isoTarget, whenIdle, whenElapsed])

  return label
}
/** Live 1Hz countdown to a future epoch-ms timestamp; re-renders each second. */
export function useCountdownMs(targetMs: number | null, labels: CountdownLabels = {}): string {
  const isoTarget = targetMs === null ? null : new Date(targetMs).toISOString()
  return useCountdown(isoTarget, labels)
}
