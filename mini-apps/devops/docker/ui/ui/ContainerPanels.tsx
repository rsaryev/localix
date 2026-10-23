import type { ContainerStats, ContainerTop } from '../../backend/contracts'
import { DetailField } from '@localixai/kit/detail-field'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { ProgressBar } from '@localixai/kit/progress-bar'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { counterRate, type StatSample } from '../model/statsHistory'
import { formatByteRate } from '../../backend/bytes'
import { DevOpsProblem, type DevOpsIssue } from '../../../ui/DevOpsProblem'
import { StatsSparkline } from './StatsSparkline'

/**
 * Live-stats panel: CPU%/mem% meters over their retained history, plus memory usage and
 * network/block I/O.
 *
 * The meters answer "how loaded is it right now"; the traces answer "is that a spike, a
 * climb, or steady state" — which is the question a stats panel is actually opened for,
 * and one a single instantaneous sample cannot answer.
 */
export function StatsPanel({
  container,
  stats,
  history,
  running,
  error,
  onRetry,
}: {
  /** Which container these are — two open container tabs are two subjects, not one. */
  container: string
  stats: ContainerStats | null
  history: readonly StatSample[]
  running: boolean
  error?: DevOpsIssue | null
  onRetry?: () => void
}) {
  if (!running)
    return <EmptyHint className="p-4">Stats are only available for a running container.</EmptyHint>
  if (error && !stats)
    return (
      <DevOpsProblem
        centered
        subject={`${container} stats`}
        issue={error ?? null}
        onRetry={onRetry}
      />
    )
  if (!stats) return <LoadingHint className="p-4">Sampling stats…</LoadingHint>
  return (
    <div className="scrollbar-thin h-full overflow-auto">
      <DevOpsProblem subject={`${container} stats`} issue={error ?? null} onRetry={onRetry} />
      <div className="flex flex-col gap-4 p-4">
        <Meter label="CPU" pct={stats.cpuPct} />
        <StatsSparkline label="CPU" values={history.map((entry) => entry.cpuPct)} />
        <Meter label="Memory" pct={stats.memPct} detail={stats.memUsage} />
        <StatsSparkline label="Memory" values={history.map((entry) => entry.memPct)} />
        <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-xs">
          <DetailField
            label="Net I/O"
            value={counterField(stats.netIO, stats.netRxBytes, [
              counterRate(history, 'netRxBytes'),
              counterRate(history, 'netTxBytes'),
            ])}
          />
          <DetailField
            label="Block I/O"
            value={counterField(stats.blockIO, stats.blockReadBytes, [
              counterRate(history, 'blockReadBytes'),
              counterRate(history, 'blockWriteBytes'),
            ])}
          />
          <DetailField label="PIDs" value={String(stats.pids)} />
        </div>
      </div>
    </div>
  )
}

/**
 * One cumulative I/O counter: Docker's own total, plus the derived in/out rate.
 *
 * Says "not reported" rather than showing `0B / 0B` when Docker supplied nothing — a
 * `--network host` container has no network counters at all, and a zero there would read
 * as "no traffic". The rate is appended only once two samples exist to diff.
 */
function counterField(
  display: string,
  counter: number | null,
  [inRate, outRate]: [number | null, number | null],
): string {
  if (counter === null) return 'not reported by Docker'
  const rates =
    inRate === null && outRate === null
      ? ''
      : ` · ↓${formatByteRate(inRate ?? 0)} ↑${formatByteRate(outRate ?? 0)}`
  return `${display || '—'}${rates}`
}

/** A labelled percentage bar (0–100 clamped). Reuses status tokens, no bespoke color. */
function Meter({ label, pct, detail }: { label: string; pct: number; detail?: string }) {
  const clamped = Math.max(0, Math.min(100, pct))
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-text-soft">{label}</span>
        <span className="tabular-nums text-text-soft">
          {pct.toFixed(2)}%{detail ? <span className="ml-2 text-text-faint">{detail}</span> : null}
        </span>
      </div>
      <ProgressBar
        value={clamped}
        className="h-1.5 w-full bg-surface-active"
        fillClassName={cn(
          'transition-[width,background-color]',
          clamped > 85
            ? 'bg-status-error'
            : clamped > 60
              ? 'bg-status-warning'
              : 'bg-status-success',
        )}
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      />
    </div>
  )
}

/** Process table from `docker top`. */
export function TopPanel({
  container,
  top,
  running,
  error,
  onRetry,
}: {
  /** Which container these are — two open container tabs are two subjects, not one. */
  container: string
  top: ContainerTop | null
  running: boolean
  error?: DevOpsIssue | null
  onRetry?: () => void
}) {
  if (!running)
    return (
      <EmptyHint className="p-4">Processes are only available for a running container.</EmptyHint>
    )
  if (error && (!top || top.headers.length === 0))
    return (
      <DevOpsProblem
        centered
        subject={`${container} processes`}
        issue={error ?? null}
        onRetry={onRetry}
      />
    )
  if (!top || top.headers.length === 0)
    return <LoadingHint className="p-4">Reading processes…</LoadingHint>
  return (
    <div className="scrollbar-thin h-full overflow-auto">
      <DevOpsProblem subject={`${container} processes`} issue={error ?? null} onRetry={onRetry} />
      <table className="w-full border-collapse text-2xs">
        {/* `/95`, not plain `bg-background`: under glass the nested ground coat is cleared by the
            paint-the-ground-once rule, so the sticky header went transparent and rows scrolled
            visibly through it. The alpha escapes that rule in the pane's own hue. */}
        {/* `lx-occluder`, not a hand-written `bg-background/95`: a coat of the pane's own ground
            composites DARKER than the pane under glass, which is the black band this head used to
            draw. The shared recipe lifts with a foreground veil and hides with the blur. */}
        <thead className="lx-occluder sticky top-0">
          <tr className="text-left text-text-faint">
            {top.headers.map((h) => (
              <th
                key={h}
                className="whitespace-nowrap px-3 py-1.5 font-medium uppercase tracking-wide"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="font-mono text-text-soft">
          {top.processes.map((row) => (
            <tr key={row.join('|')} className="border-t border-border-soft">
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={cn('px-3 py-1', j === row.length - 1 ? 'w-full' : 'whitespace-nowrap')}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
