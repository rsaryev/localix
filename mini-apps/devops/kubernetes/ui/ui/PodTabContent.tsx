import { History } from 'lucide-react'
import type { KubeEvent, KubePod } from '../../backend/contracts'
import { Button } from '@localixai/kit/button'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { LogPane } from '@localixai/kit/log-pane'
import type { PodTabView } from '../model/podTabView'
import { containerLabel } from '../model/podContainers'
import { DevOpsProblem } from '../../../ui/DevOpsProblem'
import { EventsTable } from './EventsTable'
import { ManifestView } from './ManifestView'
import { LiveLogViewer } from '../../../ui/LiveLogViewer'

interface PodTabContentProps {
  loading: boolean
  error: string | null
  pod: KubePod | null
  view: PodTabView
  podName: string
  namespace: string
  context?: string
  container: string
  logs: string
  describe: string
  events: KubeEvent[]
  viewError: string | null
  logsLive: boolean
  previousLogs: boolean
  onLogPlaybackChange: (live: boolean) => void
  onTogglePreviousLogs: () => void
}

/** The selected pod view; data fetching and race control live in `usePodTabContent`. */
export function PodTabContent(props: PodTabContentProps) {
  if (props.loading) return <LoadingHint className="p-4">Loading…</LoadingHint>
  // Empty BECAUSE it failed. `EmptyHint` is the empty-state primitive, not a failure surface.
  if (props.error && !props.pod)
    return <DevOpsProblem centered subject={props.podName} issue={{ message: props.error }} />
  if (props.view === 'manifest') {
    return (
      <ManifestView
        kind="pod"
        name={props.podName}
        namespace={props.namespace}
        context={props.context || undefined}
      />
    )
  }
  if (props.view === 'events') {
    return props.viewError && props.events.length === 0 ? (
      <DevOpsProblem
        centered
        subject={`${props.podName} events`}
        issue={{ message: props.viewError }}
      />
    ) : (
      <EventsTable events={props.events} emptyLabel="No recent events for this pod." />
    )
  }
  if (props.view === 'logs') {
    return (
      <LiveLogViewer
        subject={`${props.podName} · ${containerLabel(props.container)}`}
        content={props.logs}
        error={props.viewError}
        emptyLabel="No log output."
        ariaLabel="Pod logs"
        live={props.logsLive}
        onLiveChange={props.onLogPlaybackChange}
        downloadName={`${props.podName}-${containerLabel(props.container).replaceAll(' ', '-') || 'container'}${props.previousLogs ? '-previous' : ''}`}
        actions={
          props.pod && props.pod.restarts > 0 ? (
            <Button
              variant={props.previousLogs ? 'secondary' : 'ghost'}
              size="xs"
              title="Show logs from the last terminated container instance"
              onClick={props.onTogglePreviousLogs}
            >
              <History className="size-3" />
              Previous
            </Button>
          ) : undefined
        }
      />
    )
  }
  return (
    <LogPane aria-label="Describe output">
      {props.describe || props.viewError || 'No output.'}
    </LogPane>
  )
}
