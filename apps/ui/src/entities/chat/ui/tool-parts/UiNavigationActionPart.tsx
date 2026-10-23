import type { ToolCallItem } from '@localixai/agent/agents'
import {
  isUiNavigationAction,
  isUiNavigationSuggestions,
  type UiNavigationAction,
} from '@localixai/mini-app-sdk/ui'
import { ArrowUpRight } from 'lucide-react'
import { useMemo, useSyncExternalStore } from 'react'

import { subscribeUiCommands, uiCommandRevision } from '@/shared/contrib/uiCommands'
import { subscribeUiLocations, uiLocationRevision } from '@/shared/contrib/uiLocations'
import { useUiNavigation } from '@/shared/hooks/useUiNavigation'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import {
  navigateUiAction,
  viewUiNavigationAction,
  type UiNavigationActionView,
} from '@/shared/lib/uiNavigation'
import { ActionTooltip } from '@localixai/kit/tooltip'
import { Button } from '@localixai/kit/button'

function navigationAction(output: unknown): UiNavigationAction | null {
  return isUiNavigationAction(output) ? output : null
}

function NavigationActionButton({
  presentation,
  className,
  onNavigate,
}: {
  presentation: UiNavigationActionView
  className: string
  onNavigate: () => void
}) {
  const available = presentation.available
  const hint = available ? presentation.description : 'This destination is not currently available'
  const accessibleLabel = presentation.description
    ? `${presentation.label}. ${presentation.description}`
    : presentation.label
  const button = (
    <Button
      variant="outline"
      size="sm"
      className={className}
      disabled={!available}
      aria-label={accessibleLabel}
      onClick={onNavigate}
    >
      <span className="truncate">{presentation.label}</span>
      <ArrowUpRight data-icon="inline-end" />
    </Button>
  )

  if (!hint) return button
  return (
    <ActionTooltip
      label={hint}
      disabled={!available}
      accessibleLabel={available ? accessibleLabel : `${presentation.label}. ${hint}`}
    >
      {button}
    </ActionTooltip>
  )
}

/**
 * Provider-neutral rendering for one serialized destination or a bounded set: a button the
 * person clicks. Nothing here opens a destination on its own.
 */
export function UiNavigationActionPart({ item }: { item: ToolCallItem }) {
  const locationRevision = useSyncExternalStore(
    subscribeUiLocations,
    uiLocationRevision,
    uiLocationRevision,
  )
  const commandRevision = useSyncExternalStore(
    subscribeUiCommands,
    uiCommandRevision,
    uiCommandRevision,
  )
  const navigation = useUiNavigation({ sessionId: useWorkItemSessionId() })
  const directAction = navigationAction(item.output)

  const actions: readonly UiNavigationAction[] = isUiNavigationSuggestions(item.output)
    ? item.output.suggestions
    : directAction
      ? [directAction]
      : []
  // One resolution per button per registry revision. Every render of this part used to
  // re-run each owner's `resolve(args)` — ten buttons, on every parent re-render, not only
  // when a registry actually changed. The revisions are the only inputs that can change the
  // answer, so they are the only dependencies.
  const views = useMemo(
    () => actions.map((action) => viewUiNavigationAction(action)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revisions stand in for the registries
    [actions, locationRevision, commandRevision],
  )
  if (actions.length === 0) return null

  if (actions.length > 1 || isUiNavigationSuggestions(item.output)) {
    return (
      <div
        className="scrollbar-thin my-0.5 max-w-full overflow-x-auto overflow-y-hidden overscroll-x-contain pb-1"
        role="group"
        aria-label="Suggested destinations"
        data-ui-navigation-suggestions
      >
        <ul className="flex w-max min-w-full gap-1">
          {actions.map((action, index) => {
            const presentation = views[index]
            if (!presentation) return null
            return (
              <li key={action.uri}>
                <NavigationActionButton
                  presentation={presentation}
                  className="max-w-52 font-normal"
                  onNavigate={() => void navigateUiAction(action, navigation)}
                />
              </li>
            )
          })}
        </ul>
      </div>
    )
  }

  const action = actions[0]
  const presentation = views[0]
  if (!action || !presentation) return null

  return (
    <NavigationActionButton
      presentation={presentation}
      className="my-0.5 max-w-full font-normal"
      onNavigate={() => void navigateUiAction(action, navigation)}
    />
  )
}
