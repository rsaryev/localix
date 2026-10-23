import { LoadingHint } from '@localixai/kit/empty-hint'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@localixai/mini-app-sdk/ui/segmented-control'
import { WorkbenchToolbar } from '@localixai/kit/workbench-toolbar'
import { LiveLogViewer } from '../../../ui/LiveLogViewer'
import type { DockerContainerPanel } from '../model/containerPanel'
import type { DockerContainerTabModel } from '../model/useDockerContainerTab'
import { DevOpsProblem } from '../../../ui/DevOpsProblem'
import { StatsPanel, TopPanel } from './ContainerPanels'

const PANELS: readonly {
  value: DockerContainerPanel
  label: string
}[] = [
  { value: 'logs', label: 'Logs' },
  { value: 'stats', label: 'Stats' },
  { value: 'top', label: 'Processes' },
]

export function DockerContainerContent({
  model,
  fallbackName,
}: {
  model: DockerContainerTabModel
  fallbackName: string
}) {
  return (
    <>
      <WorkbenchToolbar aria-label="Container detail view">
        <SegmentedControl aria-label="Container detail">
          {PANELS.map((panel) => (
            <SegmentedControlItem
              key={panel.value}
              active={model.panel === panel.value}
              onClick={() => model.setPanel(panel.value)}
            >
              {panel.label}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      </WorkbenchToolbar>

      <div className="min-h-0 flex-1">
        {model.loading ? (
          <LoadingHint className="p-4">Loading…</LoadingHint>
        ) : model.error && !model.container ? (
          // Empty BECAUSE it failed — a report, not an empty-state hint.
          <DevOpsProblem centered subject={fallbackName} issue={{ message: model.error }} />
        ) : model.panel === 'logs' ? (
          <LiveLogViewer
            subject={model.container?.name ?? fallbackName}
            content={model.logs}
            error={model.logsError}
            emptyLabel="No log output."
            ariaLabel="Container logs"
            live={model.logsLive}
            onLiveChange={model.setLogPlayback}
            downloadName={model.container?.name ?? fallbackName}
          />
        ) : model.panel === 'stats' ? (
          <StatsPanel
            container={model.container?.name ?? fallbackName}
            stats={model.stats}
            history={model.statsHistory}
            running={model.running}
            error={model.statsError}
            onRetry={() => void model.refresh('stats', false)}
          />
        ) : (
          <TopPanel
            container={model.container?.name ?? fallbackName}
            top={model.top}
            running={model.running}
            error={model.topError}
            onRetry={() => void model.refresh('top', false)}
          />
        )}
      </div>
    </>
  )
}
