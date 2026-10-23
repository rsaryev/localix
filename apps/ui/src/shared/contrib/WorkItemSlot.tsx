/**
 * A NAMED HOLE IN A HOST SURFACE, filled by whichever mini app claimed it — or by nothing.
 *
 * The registry (`workItemSlots.ts`) answers "who claimed `diff.provenance`?"; this renders the
 * answer. Two files because the registry is plain data a `.ts` module can hold, and only this half
 * needs JSX — the same split the status-item seam uses, and what lets a caller ASK whether a slot
 * is claimed (`useWorkItemSlot('diff.interactive')`) before it decides to hand the whole view over.
 *
 * An unclaimed slot renders nothing at all: no wrapper, no spacing. A host surface must read the
 * same with no mini apps installed as it does with three, which a placeholder div would break.
 *
 * Props are forwarded verbatim. The host owns each slot's vocabulary — `item` plus whatever that
 * surface computed — and a component that reshaped them would become a second contract to keep in
 * step with the first.
 *
 * INSIDE A BOUNDARY, always. What renders here is mini app code on the host's render path, and
 * React hands an unhandled render error to the nearest boundary — without one that is the root, so
 * a single mini app throwing replaces the whole workspace with an error screen. That is not
 * hypothetical; `editor-grid/ui/registry.tsx` records it happening live.
 */
import { SurfaceErrorBoundary } from '@/shared/ui/SurfaceErrorBoundary'
import { useWorkItemSlot } from './workItemSlots'

export interface WorkItemSlotProps {
  /** The slot being filled, `<area>.<name>` (`diff.provenance`, `diff.interactive`). */
  slot: string
  /** Everything the owning surface passes through to the claimant. */
  [prop: string]: unknown
}

export function WorkItemSlot({ slot, ...props }: WorkItemSlotProps) {
  const contribution = useWorkItemSlot(slot)
  if (!contribution) return null
  const Component = contribution.Component
  return (
    <SurfaceErrorBoundary surface={`The ${slot} panel`}>
      <Component {...props} />
    </SurfaceErrorBoundary>
  )
}
