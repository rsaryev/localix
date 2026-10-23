import { useEffect, useState } from 'react'
import { ArrowLeft, Crosshair, Eye } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { Button } from '@localixai/kit/button'
import { FLOATING_SURFACE } from '@localixai/kit/workbench-toolbar'
import { formatChordText } from '@localixai/kit/keybindings'
import type { CameraDirector } from './useCameraDirector'
import type { Follow } from './useFollow'

/**
 * The camera's few words to the person, in one place above the board: the way BACK after a jump
 * (it stays a few seconds, then ⌥← alone keeps working), what changed off screen, and whether the
 * camera follows those changes. Nothing here when there is nothing to say.
 *
 * `lead` is the board's other live state that belongs in the same row — a trace in progress — so
 * the board has ONE strip of status above it rather than a second one that would overlap this.
 */
const BACK_VISIBLE_MS = 6_000

export function CameraChips({
  director,
  follow,
  lead,
}: {
  director: CameraDirector
  follow: Follow
  lead?: React.ReactNode
}) {
  const { canBack, jumpedAt } = director.history
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!canBack) return
    const left = jumpedAt + BACK_VISIBLE_MS - Date.now()
    if (left <= 0) return
    const timer = window.setTimeout(() => setNow(Date.now()), left + 20)
    return () => window.clearTimeout(timer)
  }, [canBack, jumpedAt])
  // `now` moves only when the timer fires, so a jump newer than it reads as fresh until then.
  const showBack = canBack && now - jumpedAt < BACK_VISIBLE_MS
  const unseen = follow.unseen.length

  if (!lead && !showBack && unseen === 0 && !follow.following) return null
  return (
    <div
      data-canvas-chrome=""
      className="nodrag nowheel pointer-events-none absolute left-1/2 top-3 z-(--z-controls) flex max-w-[calc(100%-6rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5"
    >
      {lead}
      {showBack && (
        <Chip
          onClick={() => director.back()}
          title={`Back to the previous view (${formatChordText('alt+arrowleft')})`}
        >
          <ArrowLeft aria-hidden className="size-3.5" />
          Back
        </Chip>
      )}
      {unseen > 0 && !follow.following && (
        <Chip onClick={follow.showUnseen} title="Take the camera to what changed">
          <Eye aria-hidden className="size-3.5" />
          {unseen} change{unseen === 1 ? '' : 's'} on the board · Show
        </Chip>
      )}
      {(unseen > 0 || follow.following) && (
        <Chip
          active={follow.following}
          onClick={() => follow.setFollowing(!follow.following)}
          title={
            follow.following
              ? 'The camera goes to each change; moving it yourself stops this'
              : 'Take the camera to each change as it is made'
          }
        >
          <Crosshair aria-hidden className="size-3.5" />
          {follow.following ? 'Following changes' : 'Follow'}
        </Chip>
      )}
    </div>
  )
}

export function Chip({
  children,
  onClick,
  title,
  active,
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
  active?: boolean
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        FLOATING_SURFACE,
        'space-chip pointer-events-auto max-w-full gap-1.5 whitespace-normal rounded-full px-2.5 text-2xs',
        active && 'text-status-info',
      )}
    >
      {children}
    </Button>
  )
}
