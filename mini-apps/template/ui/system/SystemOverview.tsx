import { useEffect, useState } from 'react'
import { Monitor } from 'lucide-react'
import type { PublishMessageContext } from '@localixai/plugin-sdk/ui'
import { useElementVisible } from '@localixai/plugin-sdk/ui/visibility'
import type { ProcessSnapshot } from '../../shared/processes'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { StateNotice } from '@localixai/kit/state-notice'
import { useSystem } from './useSystem'
import { systemMessageContext } from './bindings'
import { MetricCards } from './MetricCards'
import { SystemDetails } from './SystemDetails'
import { SystemCharts } from './SystemCharts'
import { CoreGrid } from './CoreGrid'
import { ProcessTable } from './ProcessTable'
import { ProblemLine } from '@localixai/plugin-sdk/ui/components'
import { useSystemProblem } from './useSystemProblem'
import { useNow } from '../useNow'
import { formatAge } from '../../shared/system'

/**
 * The dashboard: reads while visible, and publishes EXACTLY the sample on screen as
 * message context. Publishing a separately refreshed sample would let the agent
 * describe numbers the user cannot see, so context follows the rendered snapshot and
 * is cleared the moment the surface goes inactive.
 */
export function SystemOverview({
  active = true,
  publishMessageContext,
}: {
  active?: boolean
  publishMessageContext?: PublishMessageContext
}) {
  const [ref, visible] = useElementVisible<HTMLDivElement>()
  const { snapshot, history, loading, error } = useSystem(active && visible)
  const [processes, setProcesses] = useState<ProcessSnapshot | null>(null)
  // The sample's age is DERIVED from its timestamp against a clock, never counted in state.
  const now = useNow(1000, active && visible && snapshot !== null)
  useEffect(() => {
    if (!active || !snapshot) {
      publishMessageContext?.(null)
      return
    }
    publishMessageContext?.(systemMessageContext(snapshot, !!error, processes))
    return () => publishMessageContext?.(null)
  }, [active, snapshot, error, processes, publishMessageContext])

  const problem = useSystemProblem({
    subject: 'System overview',
    failure: error,
    consequence: snapshot ? 'stale' : 'blocked',
    ...(snapshot ? { title: 'Connection interrupted. Showing the last successful sample.' } : {}),
  })

  return (
    <div ref={ref} className="flex w-full flex-col gap-5 px-4 py-4 @2xl:px-6">
      {/* One overview heading across the bundled workspaces (Trading's is the same recipe): an
          `text-xl` title here and a `text-base` one there read as two apps. */}
      <header>
        <h1 className="text-base font-semibold text-foreground">System overview</h1>
        <p className="mt-0.5 text-xs text-text-faint">
          The machine running your Localix backend.
          {snapshot && ` Sampled ${formatAge(now - Date.parse(snapshot.capturedAt))}.`}
        </p>
      </header>
      {problem && <ProblemLine {...problem} />}
      {!snapshot ? (
        loading ? (
          <div className="h-64">
            <LoadingHint>Reading system information…</LoadingHint>
          </div>
        ) : (
          <StateNotice
            icon={Monitor}
            title="System information unavailable"
            body="Start the backend to see your machine here."
          />
        )
      ) : (
        <>
          <MetricCards snapshot={snapshot} />
          <SystemDetails snapshot={snapshot} />
          <SystemCharts history={history} />
          <CoreGrid cores={snapshot.cpu.cores} logicalCores={snapshot.cpu.logicalCores} />
          <ProcessTable active={active && visible} onSnapshot={setProcesses} />
        </>
      )}
    </div>
  )
}
