import { forwardRef, useEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react'
import { AvatarStack } from '@localixai/kit/avatar'
import { Button } from '@localixai/kit/button'
import { QueueItemGlyph, type QueuePanelItem } from './QueueRow'

/**
 * THE QUEUE, DOCKED BESIDE SEND. One pill says who and what waits: the participants' faces, one
 * glyph per other kind of work (the person's message, a job, a loop), and how many in all. It sits
 * in the composer's own toolbar, so the queue coming and going never moves the input. Clicking it
 * opens the full list (`ComposerQueuePanel`).
 */
export const QueueDockPill = forwardRef<
  HTMLButtonElement,
  { queue: readonly QueuePanelItem[] } & ComponentPropsWithoutRef<typeof Button>
>(function QueueDockPill({ queue, className, ...props }, ref) {
  const agents = queue.flatMap((item) => (item.agent ? [item.agent] : []))
  // One glyph per KIND, not per item: the count already says how many.
  const kinds = new Map<string, QueuePanelItem>()
  for (const item of queue) {
    if (item.agent) continue
    const kind = item.queueKind === 'wake' ? `wake:${item.wakeSource ?? ''}` : 'message'
    if (!kinds.has(kind)) kinds.set(kind, item)
  }
  const bump = useGrowthBump(queue.length)
  return (
    <Button
      ref={ref}
      variant="ghost"
      size="sm"
      type="button"
      aria-label={`Queue, ${queue.length} waiting`}
      className={[
        'gap-1.5 rounded-full border border-border-soft px-1.5 text-text-soft',
        bump ? 'lx-queue-dock-bump' : '',
        className ?? '',
      ].join(' ')}
      {...props}
    >
      {agents.length ? (
        <AvatarStack
          identities={agents.map((agent) => agent.handle)}
          labels={agents.map((agent) => agent.name)}
          size={16}
          max={3}
        />
      ) : null}
      {[...kinds.values()].map((item) => (
        <span key={item.id} className="flex size-4 items-center justify-center">
          <QueueItemGlyph item={item} />
        </span>
      ))}
      <span className="min-w-2 text-center font-medium tabular-nums text-text-strong">
        {queue.length}
      </span>
    </Button>
  )
})

/** True for one bump each time `count` grows; never on the first paint. */
function useGrowthBump(count: number): boolean {
  const previous = useRef(count)
  const [bump, setBump] = useState(false)
  useEffect(() => {
    const grew = count > previous.current
    previous.current = count
    if (!grew) return
    setBump(true)
    const timer = window.setTimeout(() => setBump(false), 500)
    return () => window.clearTimeout(timer)
  }, [count])
  return bump
}
