import { useState } from 'react'
import { Check, Download, Pause } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
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
import { indexActivity, indexLine, type IndexActivity } from '../model/semanticFormat'
import { SemanticIndexBreakdown } from './SemanticIndexBreakdown'

const ICONS: Partial<Record<IndexActivity, typeof Pause>> = {
  idle: Check,
  downloading: Download,
  paused: Pause,
}

/**
 * The status bar's semantic-search segment, VS Code style: always at the trailing edge, saying
 * indexed, or the work in hand. A click (or a right click) opens its menu — pause, resume,
 * rebuild. Search is always on with one model: there is nothing to switch or choose, and nothing
 * to fix — a failure hides the segment while the server retries and search answers from words.
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
  const detail = shown.activity === 'downloading' ? 'Downloading the model' : indexLine(status).text
  const segment = (
    <WorkbenchStatusButton
      className={cn('gap-1.5', className)}
      title={detail}
      onContextMenu={(event) => {
        event.preventDefault()
        setOpen(true)
      }}
    >
      {Icon ? <Icon className="size-3" aria-hidden="true" /> : <Spinner size="xs" />}
      <span className="tabular-nums">{text}</span>
    </WorkbenchStatusButton>
  )
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
        {shown.activity !== 'downloading' && (
          <DropdownMenuItem onSelect={() => act(() => semanticApi.rebuild())}>
            Rebuild index
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
