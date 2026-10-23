import { useEffect, useRef, useState } from 'react'
import {
  validateChartSpec,
  type ChartSpec,
  type TableColumn,
  type TableRow,
} from '@localixai/dataview'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import { CartesianChart, EmptyChart } from './CartesianChart'
import { PieChart } from './PieChart'

function useSize(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    if (!enabled) return
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      if (r) setSize({ width: r.width, height: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [enabled])
  return { ref, size }
}

/** SDK-owned dataset chart, dispatched by kind and sized to its container. */
export function ChartView({
  columns,
  rows,
  spec,
}: {
  columns: TableColumn[]
  rows: TableRow[]
  spec: ChartSpec
}) {
  const workItemVisible = useWorkItemVisible()
  const { ref, size } = useSize(workItemVisible)
  const valid = validateChartSpec(spec, columns)
  return (
    // min-w-0/min-h-0 so the measured box can shrink inside a flex parent
    // (otherwise the SVG's intrinsic size becomes the floor and the panel can
    // only grow); overflow-hidden keeps a rounding overshoot from feeding the
    // ResizeObserver back into a growth loop.
    <div ref={ref} className="h-full min-h-0 w-full min-w-0 overflow-hidden text-text-faint">
      {size.width > 0 &&
        size.height > 0 &&
        (!valid.ok ? (
          <EmptyChart message={valid.errors[0] ?? 'Invalid chart configuration'} />
        ) : spec.kind === 'pie' ? (
          <PieChart
            columns={columns}
            rows={rows}
            spec={spec}
            width={size.width}
            height={size.height}
          />
        ) : (
          <CartesianChart
            columns={columns}
            rows={rows}
            spec={spec}
            width={size.width}
            height={size.height}
          />
        ))}
    </div>
  )
}
