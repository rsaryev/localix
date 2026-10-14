import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import { cn } from '@localixai/plugin-sdk/ui/classes'

const materialClass = {
  /** Geometry only. For a state layer with nothing behind it to dim — a pane whose content
   *  is already gone, where any veil would just repaint the ground a shade off. */
  plain: '',
  dimmed: 'bg-background/70 backdrop-blur-xs',
  subtle: 'bg-background/35 backdrop-blur-[1px]',
  // `-solid`: "solid" is this overlay's contract — it must hide what is behind it, and under the
  // macOS glass theme plain `bg-background` is translucent and would leak the covered pane through.
  solid: 'bg-background-solid',
} as const

export type PaneStateOverlayMaterial = keyof typeof materialClass

export type PaneStateOverlayProps = ComponentPropsWithoutRef<'div'> & {
  /** How strongly the pane content remains visible behind the state layer. */
  material?: PaneStateOverlayMaterial
}

/**
 * A pane-local state layer for onboarding, reconnecting and recovery states.
 * It owns geometry and material only; stacking, pointer behaviour and event
 * semantics remain explicit at the call site because not every state blocks
 * interaction or announces itself in the same way.
 */
export const PaneStateOverlay = forwardRef<HTMLDivElement, PaneStateOverlayProps>(
  ({ material = 'dimmed', className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="pane-state-overlay"
      data-material={material}
      className={cn(
        'absolute inset-0 flex items-center justify-center p-4',
        materialClass[material],
        className,
      )}
      {...props}
    />
  ),
)
PaneStateOverlay.displayName = 'PaneStateOverlay'
