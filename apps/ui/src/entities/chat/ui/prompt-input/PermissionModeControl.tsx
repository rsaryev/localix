/** Conversation permission mode, shown as its own pill above the input. */
import type { ImplementationMode, SessionPlan } from '@localixai/api/client'
import { ChevronDown } from 'lucide-react'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { ComposerChip } from '@localixai/kit/composer-chip'
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
          <ComposerChip
            aria-label={
              editable
                ? `Permission mode: ${copy.label}. Change`
                : `Permission mode: ${copy.label}, set by the conversation that delegated this one`
            }
            className={`shrink-0 ${tone}`}
          >
            <Icon className="size-3.5" />
            <span>{copy.label}</span>
            <ChevronDown className="size-3 shrink-0 opacity-60" aria-hidden="true" />
          </ComposerChip>
        </DropdownMenuTrigger>
      </ActionTooltip>
      <DropdownMenuContent align="end" side="top" className="w-72">
        <MenuEntries entries={entries} family="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
