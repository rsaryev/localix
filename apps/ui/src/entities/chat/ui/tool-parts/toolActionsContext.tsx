import { createContext, useContext, useState, type ReactNode } from 'react'
import { Pause, Play, RotateCcw, Square, Wrench } from 'lucide-react'
import { toast } from '@/shared/lib/notify'
import type { ToolActionDescriptor } from '@localixai/agent/agents'
import { ApiError, backendClient } from '@/shared/api/client'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { ToolActionIconButton } from './ToolActionIconButton'
import { activeEventResource } from '@/shared/lib/notifications/context'

const EMPTY_ACTIONS: readonly ToolActionDescriptor[] = []
const ToolActionsContext = createContext<readonly ToolActionDescriptor[]>(EMPTY_ACTIONS)

export function ToolActionsProvider({
  actions,
  children,
}: {
  actions?: readonly ToolActionDescriptor[]
  children: ReactNode
}) {
  return (
    <ToolActionsContext.Provider value={actions ?? EMPTY_ACTIONS}>
      {children}
    </ToolActionsContext.Provider>
  )
}

const ACTION_ICONS = {
  pause: Pause,
  play: Play,
  'rotate-ccw': RotateCcw,
  square: Square,
} as const

function RegisteredToolAction({
  action,
  onInvoke,
}: {
  action: ToolActionDescriptor
  onInvoke?: (action: ToolActionDescriptor) => void
}) {
  const [pending, setPending] = useState(false)
  const iconKey = action.icon?.toLowerCase() as keyof typeof ACTION_ICONS | undefined
  const Icon = (iconKey && ACTION_ICONS[iconKey]) || Wrench
  const disabled = pending || action.enabled === false

  const invoke = () => {
    if (disabled) return
    onInvoke?.(action)
    setPending(true)
    void backendClient.interact(action.toolCallId, action.action).then(
      () => setPending(false),
      (error: unknown) => {
        setPending(false)
        const origin = activeEventResource('tool', action.toolCallId, action.label)
        // Only `interaction_failed` means the tool is gone (the server found no such action, or
        // the tool stopped running). Reporting every rejection that way told a person a live tool
        // had vanished when the socket had merely dropped, and threw the real reason away.
        if (error instanceof ApiError && error.code === 'interaction_failed') {
          toast.info(`“${action.label}” is no longer available`, {
            description: 'The tool has already finished.',
            origin,
          })
          return
        }
        toast.error(`Could not run “${action.label}”`, {
          description: errorMessage(error, 'Try again.'),
          origin,
        })
      },
    )
  }

  return (
    <ToolActionIconButton
      icon={Icon}
      label={pending ? `${action.label}…` : action.label}
      onClick={invoke}
      disabled={disabled}
      tone={action.tone}
      filled={iconKey === 'square'}
    />
  )
}

/** Render the current item's server-authorized lifecycle actions in its tool row. */
export function RegisteredToolActions({
  onInvoke,
}: {
  onInvoke?: (action: ToolActionDescriptor) => void
}) {
  const actions = useContext(ToolActionsContext)
  return actions.map((action) => (
    <RegisteredToolAction
      key={`${action.toolCallId}:${action.action}`}
      action={action}
      onInvoke={onInvoke}
    />
  ))
}
