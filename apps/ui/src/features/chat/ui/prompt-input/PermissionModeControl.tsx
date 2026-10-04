/**
 * WHO DECIDES WHAT THE AGENT MAY DO IN THIS CONVERSATION — the composer's control for it.
 *
 * It sits in the strip with the reasoning level and the turn budget because it answers the same
 * kind of question about pressing send: not how hard the model thinks or how long it may run,
 * but whether it stops to ask. Kept beside them so the person sees the mode at the moment they
 * hand over work, rather than discovering it from a card that never came.
 *
 * A MENU, not a cycling button. Cycling made every mode one press from the next, so reaching
 * Plan from Bypass walked through Autonomous — a mode that refuses every question — and a press
 * meant to look at the options changed one. The app's own `DropdownMenu` lists all four with
 * what each one does, and choosing is a deliberate second click.
 *
 * The trigger is the mode's ICON alone: the strip is dense, and a label that changed width with
 * every mode made it jog sideways. The icon and its colour are the readout; the name and what the
 * mode does live in the tooltip and the menu, where there is room for them.
 *
 * WHILE A PLAN WAITS, LEAVING PLAN MODE ASKS. Picking Default used to set the presented plan
 * aside in silence — the person meant "start the work", lost the Approve button, and the agent
 * retyped the plan as a new version. So with `waitingPlan` set, each mode that leaves Plan opens
 * a level with both readings of that click: approve the plan and implement in that mode, or
 * leave Plan mode and set the plan aside. Without one the menu is the plain list it always was.
 */
import type { ImplementationMode, SessionPlan } from '@localixai/api/client'
import type { MenuEntry } from '@localixai/plugin-sdk/ui'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { IconButton } from '@localixai/kit/icon-button'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { ActionTooltip } from '@localixai/kit/tooltip'
import {
  PERMISSION_MODE_COPY,
  PERMISSION_MODES,
  type PermissionMode,
} from '@localixai/api/permission-modes'
import { PERMISSION_MODE_MENU_ICON, PERMISSION_MODE_PRESENTATION } from './permissionModeIcons'

const PRESENTATION = PERMISSION_MODE_PRESENTATION

/** The menu's rows: one per mode, or — for a mode that would set a waiting plan aside — a level. */
export function permissionModeEntries({
  value,
  onChange,
  waitingPlan,
  onApprovePlan,
}: {
  value: PermissionMode
  onChange: (next: PermissionMode) => void
  waitingPlan?: Pick<SessionPlan, 'version'>
  onApprovePlan?: (mode: ImplementationMode) => void
}): MenuEntry[] {
  return PERMISSION_MODES.map((mode): MenuEntry => {
    const copy = PERMISSION_MODE_COPY[mode]
    const row = {
      id: mode,
      label: copy.label,
      description: copy.hint,
      icon: PERMISSION_MODE_MENU_ICON[mode],
    }
    if (mode === 'plan' || !waitingPlan || !onApprovePlan || value !== 'plan') {
      return {
        ...row,
        // One choice of four: its icon stays in front, the check goes at the end.
        selected: mode === value,
        onSelect: () => {
          if (mode !== value) onChange(mode)
        },
      }
    }
    const version = `v${waitingPlan.version}`
    return {
      ...row,
      items: [
        {
          id: `${mode}:approve`,
          label: `Approve plan ${version} and implement in ${copy.label}`,
          description: 'The agent is told to start the work.',
          onSelect: () => onApprovePlan(mode),
        },
        {
          id: `${mode}:leave`,
          label: 'Leave Plan mode and set the plan aside',
          description: `Plan ${version} comes back when you return to Plan mode.`,
          onSelect: () => onChange(mode),
        },
      ],
    }
  })
}

export function PermissionModeControl({
  value,
  onChange,
  editable,
  disabled,
  waitingPlan,
  onApprovePlan,
}: {
  value: PermissionMode
  onChange: (next: PermissionMode) => void
  /** False on a delegated child: it runs under its root's mode and cannot set its own. */
  editable: boolean
  disabled?: boolean
  /** The plan waiting for review in Plan mode; leaving the mode then asks what to do with it. */
  waitingPlan?: Pick<SessionPlan, 'version'>
  onApprovePlan?: (mode: ImplementationMode) => void
}) {
  const { icon: Icon, tone } = PRESENTATION[value]
  const copy = PERMISSION_MODE_COPY[value]
  const entries = permissionModeEntries({ value, onChange, waitingPlan, onApprovePlan })

  return (
    <DropdownMenu>
      <ActionTooltip
        side="top"
        label={
          editable ? `${copy.label} mode` : `${copy.label} mode — set by the parent conversation`
        }
      >
        <DropdownMenuTrigger asChild disabled={disabled || !editable}>
          <IconButton
            size="md"
            aria-label={
              editable
                ? `Permission mode: ${copy.label}. Change`
                : `Permission mode: ${copy.label}, set by the conversation that delegated this one`
            }
            className={`shrink-0 ${tone}`}
          >
            <Icon />
          </IconButton>
        </DropdownMenuTrigger>
      </ActionTooltip>
      <DropdownMenuContent align="end" side="top" className="w-72">
        <MenuEntries entries={entries} family="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
