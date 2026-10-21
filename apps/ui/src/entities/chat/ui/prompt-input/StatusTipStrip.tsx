import { memo, useMemo, useSyncExternalStore } from 'react'
import { ArrowUpRight, Lightbulb } from 'lucide-react'
import { ComposerCommandButton } from '@/shared/ui/composer-command-button'
import { WorkbenchNoticeBar } from '@localixai/kit/workbench-notice-bar'
import { Button } from '@localixai/kit/button'
import { subscribeUiCommands, uiCommandRevision } from '@/shared/contrib/uiCommands'
import { subscribeUiLocations, uiLocationRevision } from '@/shared/contrib/uiLocations'
import { useUiNavigation } from '@/shared/hooks/useUiNavigation'
import { useWorkItemSessionId } from '@localixai/plugin-sdk/ui/work-item-session'
import {
  navigateUiAction,
  viewUiNavigationAction,
  type UiNavigationActionView,
} from '@/shared/lib/uiNavigation'
import type { ComposerTip, ComposerTipAction } from '@/shared/api/tips'

interface StatusTipStripProps {
  /** Rotating contextual hint shown above the composer. */
  tip?: ComposerTip | null
  /** Hide tips for the rest of the current run. */
  onDismissTip?: () => void
}

const NO_ACTIONS: ComposerTipAction[] = []

type NavigateTipAction = Extract<ComposerTipAction, { kind: 'navigate' }>

/**
 * One destination button, resolved through the SAME registry every agent action,
 * search hit and `/open` result goes through.
 *
 * A destination that does not resolve in this build renders NOTHING rather than a
 * disabled button: a tip is advice, and advice with a dead control attached reads as
 * a bug, where one fewer button reads as nothing at all.
 *
 * Its own component, not a branch inside the list, because the navigation host is a
 * router hook — a tip whose actions are all text-inserts must not drag the router in
 * behind it.
 */
function TipNavigateButton({ action }: { action: NavigateTipAction }) {
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
  // The composer's chat (ChatSurface provides it): a tip's link opens in the chat it was shown in.
  const navigation = useUiNavigation({ sessionId: useWorkItemSessionId() })
  const serialized = useMemo(
    () => ({
      type: 'ui.navigate' as const,
      uri: action.uri,
      label: action.label,
      ...(action.description ? { description: action.description } : {}),
    }),
    [action],
  )
  // One resolution per registry revision — the revisions are the only inputs that can
  // change the answer (see UiNavigationActionPart, same rule).
  const view = useMemo<UiNavigationActionView>(
    () => viewUiNavigationAction(serialized),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revisions stand in for the registries
    [serialized, locationRevision, commandRevision],
  )
  if (!view.available) return null

  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className="font-normal"
      aria-label={view.description ? `${view.label}. ${view.description}` : view.label}
      onClick={() => void navigateUiAction(serialized, navigation)}
    >
      <span className="truncate">{view.label}</span>
      <ArrowUpRight data-icon="inline-end" />
    </Button>
  )
}

/**
 * The tip's quick actions: stage editable text in the composer, or open the place the
 * tip is talking about. Both reuse a path the product already owns — the composer bus
 * and the URI navigation registry — so a tip acts exactly like a link in a message.
 */
function TipActions({ actions }: { actions: readonly ComposerTipAction[] }) {
  return (
    <>
      {actions.map((action) =>
        action.kind === 'insert' ? (
          <ComposerCommandButton
            key={`insert:${action.text}`}
            command={action.label}
            insertText={action.text}
          />
        ) : action.kind === 'local' ? (
          <Button
            key={`local:${action.label}`}
            type="button"
            variant="ghost"
            size="xs"
            className="font-normal"
            onClick={action.onAction}
          >
            <span className="truncate">{action.label}</span>
          </Button>
        ) : (
          <TipNavigateButton key={`navigate:${action.uri}`} action={action} />
        ),
      )}
    </>
  )
}

/**
 * A quiet, single-purpose hint strip above the composer. Stream activity belongs to the
 * message footer, so this surface never repeats its spinner, phase label, model, or timer.
 */
/**
 * Memoized: the composer re-renders on every keystroke, but this strip's props
 * (`tip` is store-ish state from `useStreamTip`, `onDismissTip` is a stable
 * `useCallback`) only change when the tip itself rotates — so the bail is real.
 */
export const StatusTipStrip = memo(function StatusTipStrip({
  tip,
  onDismissTip,
}: StatusTipStripProps) {
  if (!tip) return null
  const actions = tip.actions ?? NO_ACTIONS

  return (
    <WorkbenchNoticeBar
      key={tip.id}
      icon={<Lightbulb className="size-3.5" />}
      title="Tip"
      description={tip.text}
      className="animate-in fade-in duration-(--dur-moderate)"
      actionsLabel="Tip actions"
      actions={actions.length > 0 ? <TipActions actions={actions} /> : undefined}
      onDismiss={onDismissTip}
      dismissLabel="Hide tips for this run"
    />
  )
})
