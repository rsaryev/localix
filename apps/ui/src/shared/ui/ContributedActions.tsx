import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Loader2 } from 'lucide-react'
import {
  toast,
  useActionSurface,
  type ActionContext,
  type ActionContribution,
  type ActionTarget,
} from '@localixai/mini-app-sdk/ui'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import { IconButton } from '@localixai/kit/icon-button'
import { actionMatches, contributedActions, useContributedActions } from '@/shared/contrib/actions'

/** The host supplies content and interaction; each mini app decides eligibility and destination. */
export function ContributedActions({
  target,
  surface: explicitSurface,
  className,
  size = 'sm',
}: {
  target: ActionTarget
  surface?: string
  className?: string
  size?: 'sm' | 'md'
}) {
  const sessionId = useWorkItemSessionId()
  const inheritedSurface = useActionSurface()
  const surface = explicitSurface ?? inheritedSurface
  const actions = useContributedActions()
  const [busy, setBusy] = useState<string | null>(null)
  const inFlight = useRef(false)
  const workItemVisible = useWorkItemVisible()
  const context = useMemo<ActionContext | null>(
    () => (sessionId && surface ? { sessionId, surface, target } : null),
    [sessionId, surface, target],
  )
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!context || !workItemVisible) return () => {}
      const releases = actions.map((action) => {
        try {
          return action.subscribe?.(context, onChange)
        } catch {
          return undefined
        }
      })
      return () => {
        for (const release of releases) release?.()
      }
    },
    [actions, context, workItemVisible],
  )
  // A primitive snapshot only changes when eligibility changes. Board geometry updates need
  // not re-render every fragment, and no destination-specific state enters the transcript.
  const visibility = useCallback(
    () => actions.map((action) => (context && actionMatches(action, context) ? '1' : '0')).join(''),
    [actions, context],
  )
  const eligible = useSyncExternalStore(subscribe, visibility, visibility)
  if (!context) return null
  const visible = actions.filter((_, index) => eligible[index] === '1')
  const run = async (action: ActionContribution) => {
    if (
      inFlight.current ||
      !contributedActions().includes(action) ||
      !actionMatches(action, context)
    )
      return
    inFlight.current = true
    setBusy(action.id)
    try {
      const result = await action.run(context)
      toast.success(result?.message || 'Action completed')
    } catch (error) {
      toast.error('Could not complete the action', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      inFlight.current = false
      setBusy(null)
    }
  }
  return visible.map((action) => (
    <IconButton
      key={action.id}
      size={size}
      className={className}
      disabled={busy !== null}
      aria-label={action.title || action.label}
      tooltip={action.title || action.label}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void run(action)
      }}
    >
      {busy === action.id ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <action.Icon className="size-3.5" />
      )}
    </IconButton>
  ))
}
