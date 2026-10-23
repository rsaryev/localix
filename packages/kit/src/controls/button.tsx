import * as React from 'react'
import { Slot } from 'radix-ui'

import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { buttonVariants, type ButtonVariants } from './button-variants'
import { LocalixBorderBeam, RECOMMENDED_BEAM_INTENSITY } from '../feedback/localix-border-beam'

type ButtonProps = React.ComponentPropsWithoutRef<'button'> &
  ButtonVariants & {
    asChild?: boolean
    /**
     * The one safe, expected next step on its surface: the accent travels gently around its edge.
     * Never on a permission grant, a destructive action, or while the run is busy; the caller drops
     * it once the step is taken. Ignored with `asChild` (the child owns its single element).
     */
    recommended?: boolean
  }

/**
 * THE NEXT STEP IS MARKED WITH THE EFFECT THE PRODUCT ALREADY USES FOR "LOOK HERE" — not a second
 * animation. A plan waiting for approval sat among four quiet buttons and nothing said which one
 * the person was expected to press, while the participants strip already draws the eye with the
 * travelling accent. So the same `LocalixBorderBeam`, `focus` variant at intensity 2: above a queued
 * participant (1, "waiting, further away"), well below the speaker (4, "working, costing now") and
 * without the glow step that 3 adds — it must read as suggested, not as busy. Reduced motion
 * freezes the beam into a static rim (`effects.css`). The intensity is shared with a recommended
 * menu row (`RECOMMENDED_BEAM_INTENSITY`), so a trigger and the row it opens onto read as one cue.
 */

/**
 * The variants painted with a solid fill. Around these the beam must lead with the accent and
 * stand off the edge (`LocalixBorderBeam` `surface="fill"`): the ground beam's bright stop is the
 * foreground, the very colour of a `mono` fill, so the recommended Approve showed nothing.
 */
const FILLED_VARIANTS: ReadonlySet<string> = new Set(['mono', 'destructive-solid'])

type WorkbenchSashProps = Omit<
  React.ComponentPropsWithoutRef<'div'>,
  | 'aria-label'
  | 'aria-orientation'
  | 'aria-valuemax'
  | 'aria-valuemin'
  | 'aria-valuenow'
  | 'aria-valuetext'
  | 'role'
  | 'tabIndex'
  | 'title'
> & {
  /** Accessible name of the pane or track boundary being resized. */
  label: string
  orientation: 'horizontal' | 'vertical'
  valueNow: number
  valueMin?: number
  valueMax?: number
  valueText?: string
  /** Present when Enter/Space/double-click restores a default or equal split. */
  resetLabel?: string
  active?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'default',
      size = 'default',
      asChild = false,
      type = 'button',
      recommended = false,
      children,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot.Root : 'button'
    // A disabled control cannot be the next step, whatever its caller computed.
    const beam = recommended && !asChild && !props.disabled

    return (
      <Comp
        ref={ref}
        data-slot="button"
        data-variant={variant}
        data-size={size}
        data-recommended={beam || undefined}
        // An `asChild` consumer owns its element semantics (e.g. an <a> must not
        // receive a button type); native buttons remain safe inside forms by default.
        type={asChild ? undefined : type}
        // `relative` is the beam's containing block; a caller's own positioning still wins.
        className={cn(buttonVariants({ variant, size }), beam && 'relative', className)}
        {...props}
      >
        {/* `asChild` never gets the beam, so its Slot keeps the single child it requires. */}
        {beam ? (
          <>
            {children}
            <LocalixBorderBeam
              active
              variant="focus"
              intensity={RECOMMENDED_BEAM_INTENSITY}
              surface={FILLED_VARIANTS.has(variant ?? 'default') ? 'fill' : 'ground'}
            />
          </>
        ) : (
          children
        )}
      </Comp>
    )
  },
)
Button.displayName = 'Button'

/**
 * One IDE sash contract for editor splits, sidebars, tables and nested panels.
 * The element itself remains the exact hit target, with no tooltip wrapper or
 * portal that could offset drag geometry. Pointer help is carried by the resize
 * cursor/hover line; keyboard help is explicit ARIA data.
 * It lives with the startup control foundation so the shell gains no preload.
 */
const WorkbenchSash = React.forwardRef<HTMLDivElement, WorkbenchSashProps>(
  (
    {
      className,
      label,
      orientation,
      valueNow,
      valueMin = 0,
      valueMax = 100,
      valueText,
      resetLabel,
      active = false,
      ...props
    },
    ref,
  ) => {
    const axisKeys = orientation === 'vertical' ? 'ArrowLeft ArrowRight' : 'ArrowUp ArrowDown'
    const hint = [
      'Drag to resize',
      'Use arrow keys to adjust',
      resetLabel ? `Double-click or Enter to ${resetLabel}` : undefined,
    ]
      .filter(Boolean)
      .join(' · ')

    return (
      <div
        ref={ref}
        data-slot="workbench-sash"
        role="separator"
        aria-label={label}
        // `aria-description` is GLOBAL in ARIA 1.3, so it applies here despite what
        // `jsx-a11y/role-supports-aria-props` believes — its table predates that, and the attribute
        // is supported in the Chromium webview this ships in. Pinned by six tests on purpose; the
        // lint rule is the thing that is out of date, which is why it is a warning and not an error.
        aria-description={hint}
        aria-orientation={orientation}
        aria-valuemin={valueMin}
        aria-valuemax={valueMax}
        aria-valuenow={valueNow}
        aria-valuetext={valueText}
        aria-keyshortcuts={`${axisKeys} Home End${resetLabel ? ' Enter Space' : ''}`}
        tabIndex={0}
        data-active={active || undefined}
        className={cn('lx-sash', className)}
        {...props}
      />
    )
  },
)
WorkbenchSash.displayName = 'WorkbenchSash'

export { Button, WorkbenchSash }
export type { WorkbenchSashProps }
