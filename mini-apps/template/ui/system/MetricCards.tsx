import { Cpu, MemoryStick, Clock3 } from 'lucide-react'
import { formatBytes, formatUptime, type SystemSnapshot } from '../../shared/system'
import { ProgressBar } from '@localixai/kit/progress-bar'

/** The three headline numbers; each card is one glance, so no card carries two values. */
export function MetricCards({ snapshot }: { snapshot: SystemSnapshot }) {
  const memoryPercent =
    snapshot.memory.totalBytes > 0
      ? (snapshot.memory.usedBytes / snapshot.memory.totalBytes) * 100
      : 0
  return (
    <section aria-label="System metrics" className="grid grid-cols-1 gap-3 @md:grid-cols-3">
      <Metric
        title="CPU utilization"
        value={
          snapshot.cpu.usagePercent === null ? '—' : `${snapshot.cpu.usagePercent.toFixed(1)}%`
        }
        detail={
          snapshot.cpu.usagePercent === null
            ? 'Collecting the next sample…'
            : `${snapshot.cpu.logicalCores} logical cores · sampled usage`
        }
        Icon={Cpu}
        percent={snapshot.cpu.usagePercent}
      />
      <Metric
        title="Memory in use"
        value={formatBytes(snapshot.memory.usedBytes)}
        detail={`${formatBytes(snapshot.memory.totalBytes)} total · ${Math.round(memoryPercent)}% used`}
        Icon={MemoryStick}
        percent={memoryPercent}
      />
      <Metric
        title="System uptime"
        value={formatUptime(snapshot.os.uptimeSeconds)}
        detail={`${snapshot.os.name} · ${snapshot.os.architecture}`}
        Icon={Clock3}
        percent={null}
      />
    </section>
  )
}

function Metric({
  title,
  value,
  detail,
  Icon,
  percent,
}: {
  title: string
  value: string
  detail: string
  Icon: typeof Cpu
  percent: number | null
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex items-center gap-2 text-xs text-text-soft">
        <Icon className="size-3.5" />
        {title}
      </div>
      <div className="text-3xl font-medium tracking-tight tabular-nums">{value}</div>
      <p className="min-h-4 text-xs text-text-faint">{detail}</p>
      <div className="mt-auto h-1">
        {percent !== null && (
          <ProgressBar
            value={percent}
            className="h-1"
            aria-label={title}
            aria-valuenow={Math.round(percent)}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        )}
      </div>
    </div>
  )
}
