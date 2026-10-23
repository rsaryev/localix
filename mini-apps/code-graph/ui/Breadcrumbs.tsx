import { ChevronRight, Ellipsis } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { Button } from '@localixai/kit/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { TextAction } from '@localixai/kit/text-action'
import type { Crumb } from '../shared/view'
import { KIND_ICON, KIND_TINT } from './kinds'

/**
 * Where you are, as one path: the project's folders down to the level, then — in the call lens —
 * every declaration you followed. Each step goes back to it. A symbol step carries its kind's icon,
 * so the point where the path leaves the folders for the code is visible at a glance, and a step
 * from another file names that file in its tooltip.
 *
 * A long path keeps its first step and its last few, and folds the middle into a menu, the way
 * editors fold a deep breadcrumb: the ends are what orient; the middle is one click away.
 */
export interface LevelCrumb extends Crumb {
  /** Tooltip: where a step lives, when that is not obvious from the steps before it. */
  hint?: string
}

const KEEP_TAIL = 4

export function Breadcrumbs({
  crumbs,
  onPick,
}: {
  crumbs: readonly LevelCrumb[]
  onPick: (crumb: LevelCrumb) => void
}) {
  const folded = crumbs.length > KEEP_TAIL + 2 ? crumbs.slice(1, crumbs.length - KEEP_TAIL) : []
  const shown =
    folded.length > 0
      ? [crumbs[0] as LevelCrumb, ...crumbs.slice(crumbs.length - KEEP_TAIL)]
      : crumbs
  return (
    <nav
      aria-label="Where you are"
      className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden text-xs"
    >
      {shown.map((crumb, index) => {
        const last = index === shown.length - 1
        const symbol = crumb.kind && crumb.kind !== 'directory' && crumb.kind !== 'file'
        const Icon = symbol && crumb.kind ? KIND_ICON[crumb.kind] : null
        return (
          <span
            key={crumb.id}
            className={cn('flex min-w-0 items-center gap-0.5', last ? 'shrink-0' : 'shrink')}
          >
            {index > 0 && <ChevronRight aria-hidden className="size-3 shrink-0 text-text-faint" />}
            {index === 1 && folded.length > 0 && (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`${folded.length} more steps`}
                    >
                      <Ellipsis className="size-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {folded.map((step) => {
                      const StepIcon = step.kind ? KIND_ICON[step.kind] : null
                      return (
                        <DropdownMenuItem key={step.id} onSelect={() => onPick(step)}>
                          {StepIcon && (
                            <StepIcon
                              className={cn('size-3.5', step.kind ? KIND_TINT[step.kind] : '')}
                            />
                          )}
                          {step.name}
                        </DropdownMenuItem>
                      )
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
                <ChevronRight aria-hidden className="size-3 shrink-0 text-text-faint" />
              </>
            )}
            {Icon && crumb.kind && (
              <Icon aria-hidden className={cn('size-3.5 shrink-0', KIND_TINT[crumb.kind])} />
            )}
            {last ? (
              <span className="truncate font-medium text-foreground" title={crumb.hint}>
                {crumb.name}
              </span>
            ) : (
              <TextAction
                className="truncate rounded-sm px-1 text-text-soft hover:text-foreground"
                {...(crumb.hint ? { tooltip: crumb.hint } : {})}
                onClick={() => onPick(crumb)}
              >
                {crumb.name}
              </TextAction>
            )}
          </span>
        )
      })}
    </nav>
  )
}
