import type { ReactNode } from 'react'
import { useChordHint } from '@/shared/lib/keybindings'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { IconButton, type IconButtonProps } from '@localixai/kit/icon-button'
import { railBtn, railBtnActive } from '@localixai/kit/rail-button'

type RailButtonProps = Omit<
  IconButtonProps,
  | 'aria-current'
  | 'aria-label'
  | 'aria-pressed'
  | 'children'
  | 'size'
  | 'surface'
  | 'tooltip'
  | 'tooltipSide'
> & {
  icon: ReactNode
  label: string
  chordId?: string
  active: boolean
  activeAria?: 'current' | 'pressed'
}

/**
 * One rail icon button. The single shape behind the FIXED rail entries (new chat,
 * history, settings, relocated main views): base style + the active accent, with
 * the active state announced as `aria-current` (navigation) or `aria-pressed`
 * (toggle).
 */
export function RailButton({
  icon,
  label,
  chordId,
  active,
  activeAria = 'current',
  className,
  ...props
}: RailButtonProps) {
  const hint = useChordHint()
  return (
    <IconButton
      aria-label={label}
      size="touch"
      tooltip={hint(label, chordId)}
      tooltipSide="right"
      className={cn(railBtn, active && railBtnActive, className)}
      aria-current={activeAria === 'current' && active ? 'true' : undefined}
      aria-pressed={activeAria === 'pressed' ? active : undefined}
      {...props}
    >
      {icon}
    </IconButton>
  )
}

/**
 * Hairline group separator. The rail reads as three semantic groups — navigation
 * (new chat / history), the customizable tools zone, and system actions (settings /
 * update). A short centered 1px rule between them makes the grouping legible
 * without boxing the icons in.
 */
export function RailDivider() {
  return <div className="my-1 h-px w-5 shrink-0 rounded-full bg-border/70" aria-hidden="true" />
}

export type { RailButtonProps }
