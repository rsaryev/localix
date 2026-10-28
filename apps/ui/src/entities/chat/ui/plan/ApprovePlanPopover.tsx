/**
 * "Approve ▾" — approving a plan is choosing HOW FREELY the work proceeds. A menu of one choice
 * and the act.
 *
 * It IS the app's menu (`DropdownMenu` + `MenuEntries`, the composer mode menu's family): a Mode
 * row whose value is its `hint` and whose submenu lists the modes as that menu does — toned icon,
 * name, what it means, a check on the chosen one; then Approve. A pick keeps the menu open and
 * steps back to the rows, so the person sees the answer before approving; only Approve closes it,
 * and only once the approval is recorded. The ordinary answer is preselected — Default — so
 * Approve stays two clicks away. The conversation's one agent starts the work.
 *
 * It opens ABOVE its trigger like every composer chip: the plan strip sits on the composer, and a
 * menu opening downward lands over the message being written (Radix flips it when there is no
 * room, as in the plan tab's header). ⌘/Ctrl+Enter approves; Escape closes.
 */
import { useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import type { ImplementationMode } from '@localixai/api/client'
import { PERMISSION_MODE_COPY } from '@localixai/api/permission-modes'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import { Button } from '@localixai/kit/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'

import { isPrimaryModifier } from '@/shared/lib/keybindings'
import { PERMISSION_MODE_MENU_ICON } from '../prompt-input/permissionModeIcons'

/**
 * WHICH DECISION ON A WAITING PLAN IS THE EXPECTED NEXT STEP — one answer for the strip, the plan
 * tab and the attention dialog, so the three cannot mark different buttons for the same version.
 * Open comments mean the person has something to tell the agent, so sending them is the step;
 * without any, approving is. Not for a decided version: there is nothing left to suggest. The run
 * is never busy here — presenting a plan ends the author's turn while it waits.
 */
export type PlanNextStep = 'approve' | 'request-changes' | null

export function planNextStep(presented: boolean, openComments: number): PlanNextStep {
  if (!presented) return null
  return openComments > 0 ? 'request-changes' : 'approve'
}

/** The order they are offered in, the careful one first and selected. */
const MODES: readonly ImplementationMode[] = ['default', 'bypass', 'autonomous']

export function ApprovePlanPopover({
  version,
  onApprove,
  disabled,
  busy,
  recommended = false,
  size = 'sm',
}: {
  version?: number
  /** Answers whether the approval was recorded; the menu closes only then. */
  onApprove: (mode: ImplementationMode) => Promise<boolean>
  disabled?: boolean
  busy?: boolean
  /** Approving is the expected next step here (`planNextStep`); dropped while a decision runs. */
  recommended?: boolean
  size?: 'xs' | 'sm'
}) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<ImplementationMode>('default')

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    // Each opening starts from the ordinary answer: Default.
    if (!next) setMode('default')
  }

  const submit = () => {
    if (busy) return
    void onApprove(mode).then((recorded) => {
      if (recorded) onOpenChange(false)
    })
  }

  const entries: MenuEntry[] = [
    { header: version ? `Approve plan v${version}` : 'Approve plan' },
    {
      id: 'mode',
      label: 'Mode',
      icon: PERMISSION_MODE_MENU_ICON[mode],
      hint: PERMISSION_MODE_COPY[mode].label,
      items: MODES.map((option) => ({
        id: `mode:${option}`,
        label: PERMISSION_MODE_COPY[option].label,
        description: PERMISSION_MODE_COPY[option].hint,
        icon: PERMISSION_MODE_MENU_ICON[option],
        selected: option === mode,
        keepOpen: true,
        onSelect: () => setMode(option),
      })),
    },
    { separator: true },
    {
      id: 'approve',
      label: busy ? 'Approving…' : 'Approve',
      icon: Check,
      disabled: busy,
      // The same mark as the trigger, under the same rule (`planNextStep`): the menu it opens
      // onto would otherwise lose the cue exactly where the act has to be found.
      recommended: recommended && !busy,
      // Stays open until the approval is recorded, so a refused one keeps the picks.
      keepOpen: true,
      onSelect: submit,
    },
  ]

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild disabled={disabled || busy}>
        <Button
          variant="mono"
          size={size}
          aria-label="Approve plan"
          recommended={recommended && !busy && !disabled}
        >
          <Check data-icon="inline-start" aria-hidden />
          {busy ? 'Approving…' : 'Approve'}
          <ChevronDown data-icon="inline-end" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="top"
        className="w-64"
        onKeyDown={(event) => {
          // ⌘/Ctrl+Enter approves, as it sends in the composer.
          if (event.key === 'Enter' && isPrimaryModifier(event)) {
            event.preventDefault()
            submit()
          }
        }}
      >
        <MenuEntries entries={entries} family="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
