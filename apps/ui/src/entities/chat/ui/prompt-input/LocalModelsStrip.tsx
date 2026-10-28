import { memo, type ReactNode } from 'react'
import { Download, Pause, Play, X } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import { ProgressBar } from '@localixai/kit/progress-bar'
import { WorkbenchNoticeBar } from '@localixai/kit/workbench-notice-bar'
import { localModelsApi } from '@/shared/api/localModelsApi'
import { useLocalModelsStatus } from '@/shared/hooks/useLocalModels'
import { etaLabel, isActiveJob, jobLine, jobPercent } from '@/shared/lib/localModelsFormat'

/**
 * Local model downloads, where the app's own update shows: one quiet line above the focused
 * composer while a model downloads or waits paused — its name (truncated; the full facts are its
 * tooltip), percent and time left, a progress bar, and icon controls: pause or resume, cancel.
 * A message sent to that model meanwhile is answered once it is here.
 */
export const LocalModelsStrip = memo(function LocalModelsStrip({
  isFocused,
}: {
  isFocused: boolean
}) {
  const { status, refresh } = useLocalModelsStatus(isFocused)
  if (!isFocused || !status) return null
  const run = (action: Promise<unknown>) => void action.finally(() => void refresh())
  // Downloads fetched ahead of need stay quiet: the status bar shows the one search waits on.
  const active = status.jobs.filter((job) => isActiveJob(job) && !job.background)
  const pausedShown = status.paused.filter((p) => !p.background)
  const others = active.length + pausedShown.length - 1
  const control = (label: string, icon: ReactNode, onClick: () => void) => (
    <IconButton size="xs" aria-label={label} tooltip={label} onClick={onClick}>
      {icon}
    </IconButton>
  )
  // One line whatever the name: it truncates, and the full facts are the row's tooltip.
  const name = (label: string, detail: string) => (
    <span className="block truncate" title={detail}>
      {label}
    </span>
  )
  const meta = (parts: Array<string | null>) =>
    [...parts, others > 0 ? `+${others}` : null].filter(Boolean).join(' · ')

  const job = active[0]
  const paused = job ? undefined : pausedShown[0]
  if (!job && !paused) return null
  const percent = job
    ? (jobPercent(job) ?? 0)
    : Math.round((paused!.received / Math.max(1, paused!.total)) * 100)
  const id = job?.modelId ?? paused!.modelId

  return (
    <WorkbenchNoticeBar
      role="status"
      icon={job ? <Download className="size-3.5" /> : <Pause className="size-3.5" />}
      title={name(job?.label ?? paused!.label, job ? jobLine(job) : 'Download paused')}
      description={
        <span className="tabular-nums">
          {job
            ? meta([`${percent}%`, etaLabel(job.total - job.received, job.rate)])
            : meta(['Paused', `${percent}%`])}
        </span>
      }
      actionsLabel="Download actions"
      actions={
        <>
          <ProgressBar
            value={percent}
            className="h-1 w-20"
            aria-label="Download progress"
            aria-valuenow={percent}
          />
          {job
            ? control('Pause download', <Pause />, () => run(localModelsApi.pause(id)))
            : control('Resume download', <Play />, () => run(localModelsApi.install(id)))}
          {control('Cancel download', <X />, () => run(localModelsApi.cancel(id)))}
        </>
      }
    />
  )
})
