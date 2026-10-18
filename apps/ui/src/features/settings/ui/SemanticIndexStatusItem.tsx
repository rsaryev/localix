import { useState } from 'react'
import { AlertTriangle, Check, Download, Pause } from 'lucide-react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { ProgressBar } from '@localixai/kit/progress-bar'
import { Spinner } from '@localixai/kit/spinner'
import { WorkbenchStatusButton } from '@localixai/kit/workbench-statusbar'
import { semanticApi, type SemanticStatus } from '@/shared/api/semanticApi'
import { useSemanticStatus } from '@/shared/hooks/useLocalModels'
import { openModelPicker } from '@/shared/lib/modelPickerBus'
import { indexActivity, indexLine, type IndexActivity } from '../model/semanticFormat'
import { SemanticIndexBreakdown } from './SemanticIndexBreakdown'

const ICONS: Partial<Record<IndexActivity, typeof Pause>> = {
  idle: Check,
  downloading: Download,
  paused: Pause,
  failed: AlertTriangle,
}

/** The model picker, open on semantic search: where it is switched on and its model chosen. */
const openSemanticWorkload = () => openModelPicker({ workload: 'semanticSearch' })

/**
 * The status bar's semantic-search segment, VS Code style: always at the trailing edge, saying
 * off, indexed, or the work in hand. Off, a click opens the model picker on semantic search to
 * switch it on; on, a click (or a right click) opens its menu — pause, resume, rebuild, the model.
 */
export function SemanticIndexStatusItem({ className }: { className?: string }) {
  const { status, refresh } = useSemanticStatus()
  const [open, setOpen] = useState(false)
  const shown = status ? indexActivity(status) : null
  if (!status || !shown) return null

  const act = (action: () => Promise<SemanticStatus>) => {
    void action().then((next) => refresh(next, { revalidate: false }))
  }
  const Icon = ICONS[shown.activity]
  const text = shown.percent === null ? shown.label : `${shown.label} ${shown.percent}%`
  const detail =
    shown.activity === 'downloading'
      ? 'Downloading the model'
      : shown.activity === 'failed'
        ? (status.install.error ??
          status.engine.error ??
          status.index.lastError ??
          'Indexing failed')
        : indexLine(status).text
  const segment = (
    <WorkbenchStatusButton
      className={cn(
        'gap-1.5',
        shown.activity === 'failed' && 'text-status-warning',
        shown.activity === 'off' && 'text-text-faint',
        className,
      )}
      title={shown.activity === 'off' ? 'Turn on semantic search' : detail}
      onClick={shown.activity === 'off' ? openSemanticWorkload : undefined}
      onContextMenu={(event) => {
        event.preventDefault()
        if (shown.activity === 'off') openSemanticWorkload()
        else setOpen(true)
      }}
    >
      {Icon ? (
        <Icon className="size-3" aria-hidden="true" />
      ) : shown.activity === 'off' ? null : (
        <Spinner size="xs" />
      )}
      <span className="tabular-nums">{text}</span>
    </WorkbenchStatusButton>
  )
  if (shown.activity === 'off') return segment

  const working = shown.activity === 'building' || shown.activity === 'updating'
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{segment}</DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="w-80">
        {/* A plain header, not the kit's uppercase section label: the feature, then its state. */}
        <DropdownMenuLabel className="space-y-2 px-2 pt-2 pb-2.5 font-normal normal-case tracking-normal">
          <div className="space-y-0.5">
            <p className="text-xs/4 font-medium text-foreground">Semantic search</p>
            <p className="text-2xs/4 text-text-faint">
              <span className="text-text-soft">{status.model.label}</span> · {detail}
            </p>
          </div>
          {/* A build shows per category below; only the model's download has one bar here. */}
          {shown.activity === 'downloading' && shown.percent !== null && (
            <ProgressBar
              value={shown.percent}
              className="h-1"
              aria-label="Index progress"
              aria-valuenow={shown.percent}
            />
          )}
        </DropdownMenuLabel>
        {shown.activity !== 'downloading' && (
          <SemanticIndexBreakdown collections={status.index.collections} />
        )}
        <DropdownMenuSeparator />
        {working && (
          <DropdownMenuItem onSelect={() => act(() => semanticApi.pause())}>
            Pause indexing
          </DropdownMenuItem>
        )}
        {shown.activity === 'paused' && (
          <DropdownMenuItem onSelect={() => act(() => semanticApi.resume())}>
            Resume indexing
          </DropdownMenuItem>
        )}
        {shown.activity === 'failed' && (
          <DropdownMenuItem onSelect={() => act(() => semanticApi.retry())}>
            Try again
          </DropdownMenuItem>
        )}
        {shown.activity !== 'downloading' && (
          <DropdownMenuItem onSelect={() => act(() => semanticApi.rebuild())}>
            Rebuild index
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={openSemanticWorkload}>Choose model…</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => act(() => semanticApi.disable())}>
          Turn off
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
