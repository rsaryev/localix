import { Share2, Square } from 'lucide-react'
import type { PortForward } from '../../backend/contracts'
import { ActivityOrb } from '@localixai/kit/activity-orb'
import { Button } from '@localixai/kit/button'
import { StatusDot } from '@localixai/kit/status-dot'

/** Compact, pod-local lifecycle surface for forwards started from this tab. */
export function PodPortForwards({
  forwards,
  stopping,
  onStop,
}: {
  forwards: readonly PortForward[]
  stopping: ReadonlySet<string>
  onStop: (id: string) => void
}) {
  if (forwards.length === 0) return null

  return (
    <div className="border-b border-border-soft px-3 py-1.5" aria-label="Active pod port forwards">
      <div className="flex min-w-0 items-center gap-1.5 text-2xs">
        <Share2 className="size-3 shrink-0 text-text-faint" aria-hidden="true" />
        <span className="font-medium text-text-soft">Port forwards</span>
        <span className="truncate text-text-faint">
          {forwards.length} active · Stops when this pod tab closes
        </span>
      </div>
      <div role="list" className="mt-1 divide-y divide-border-faint">
        {forwards.map((forward) => {
          const isStopping = stopping.has(forward.id)
          return (
            <div
              role="listitem"
              key={forward.id}
              className="grid min-h-[var(--chrome-control-md)] grid-cols-[0.5rem_minmax(0,1fr)_auto] items-center gap-2 text-2xs text-text-soft"
              title={`127.0.0.1:${forward.localPort} → ${forward.pod}:${forward.podPort}`}
              aria-busy={isStopping || undefined}
            >
              <span className="relative flex size-2 items-center justify-center">
                {isStopping ? (
                  <ActivityOrb className="absolute size-3.5" />
                ) : (
                  <StatusDot size="md" className="bg-status-success" label="Port forward active" />
                )}
              </span>
              <span className="min-w-0 truncate tabular-nums">
                <span className="font-medium text-foreground">localhost:{forward.localPort}</span>
                <span className="mx-1.5 text-text-faint" aria-hidden="true">
                  →
                </span>
                {forward.pod}:{forward.podPort}
              </span>
              {isStopping ? (
                <span role="status" className="px-2 text-text-faint">
                  Stopping
                </span>
              ) : (
                <Button
                  variant="ghost"
                  size="xs"
                  aria-label={`Stop localhost:${forward.localPort} forward`}
                  title="Stop forward"
                  onClick={() => onStop(forward.id)}
                >
                  <Square className="size-3" />
                  Stop
                </Button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
