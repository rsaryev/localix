import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@localixai/kit/button'
import { ChevronUp } from 'lucide-react'
import { findCatalogModelForConnection, type CatalogModel } from '@localixai/agent/catalog'
import { liveRouteModel } from './model-select/taskReasoning'
import type { useConnections } from './useConnections'
import type { ReasoningEffort } from '../../model/reasoning'
import type { SessionAgentRoute, SessionModelChoicesView } from '@/shared/api/contracts'
import { modelTriggerLabel } from './modelTriggerLabel'
import { subscribeModelPicker, type ModelPickerRequest } from '@/shared/lib/modelPickerBus'
import { useChatStore } from '../../model/store'
import type { PartyRouteChoice } from '../../model/sessionPartyRoute'
import { findSessionInState } from '../../model/findSession'
import { notifyPartyRouteFailure } from './model-select/partyRouteFailure'

// The trigger is present in every composer, while Vaul + the model-routing
// browser are interaction-only. Keep the whole modal graph out of startup and
// warm BOTH split chunks concurrently on intent: loading the drawer first and
// discovering ModelBrowser only after render would add a second network round-trip.
const loadModelPickerDrawer = async () => {
  const [drawer] = await Promise.all([
    import('./ModelPickerDrawer'),
    import('./model-select/ModelBrowser'),
  ])
  return drawer
}
const ModelPickerDrawer = lazy(() =>
  loadModelPickerDrawer().then((module) => ({ default: module.ModelPickerDrawer })),
)

/** A session nobody has chosen a model in yet; one constant so the drawer's rows stay memoized. */
const NO_CHOICES: SessionModelChoicesView = { agents: {} }

interface ModelSearchSelectProps {
  models: CatalogModel[]
  value: string
  /** Persists the pair as one session update. `agentId` names the participant it is for. */
  onSelectionChange: (
    connectionId: string,
    modelId: string,
    reasoningEffort?: ReasoningEffort,
    agentId?: string,
  ) => void | Promise<void>
  /** Who this conversation is with — the workload column lists them and routes each. */
  participants?: readonly SessionAgentRoute[]
  /** Scope for resolving participant display names ('' = global). */
  participantScope?: string
  connectionsState: ReturnType<typeof useConnections>
  disabled?: boolean
  reasoningEffort: ReasoningEffort
  onReasoningEffortChange: (effort: ReasoningEffort, agentId?: string) => void
  sessionId: string | null
  focused: boolean
  /** The participant whose model the trigger shows in a group; absent means the first one. */
  selectedAgentId?: string | null
  /** Picking a participant inside the picker selects it in the composer too. */
  onSelectAgent?: (agentId: string) => void
}

/**
 * The in-chat model picker: a drawer trigger that shows the active connection +
 * model, opening the shared `ModelBrowser` (task → provider → model, with hover
 * details). The same browser backs the onboarding provider step.
 */
/**
 * Memoized: `models` is memoized upstream (`filteredModels`), `connectionsState`
 * is now a memoized object (see `useConnections`), and the two setters are
 * `useCallback`s in ChatSurface — so the props are stable across a keystroke and
 * the catalog lookup + trigger subtree bail out.
 */
export const ModelSearchSelect = memo(function ModelSearchSelect({
  models,
  value,
  onSelectionChange,
  connectionsState,
  disabled,
  reasoningEffort,
  onReasoningEffortChange,
  participants,
  participantScope,
  sessionId,
  focused,
  selectedAgentId,
  onSelectAgent,
}: ModelSearchSelectProps) {
  const { activeConnection, activeId } = connectionsState
  const [open, setOpen] = useState(false)
  const [drawerMounted, setDrawerMounted] = useState(false)
  const [seed, setSeed] = useState<(ModelPickerRequest & { revision: number }) | null>(null)
  const seedRevision = useRef(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)

  useEffect(() => {
    if (wasOpen.current && !open) triggerRef.current?.focus()
    wasOpen.current = open
  }, [open])

  useEffect(
    () =>
      subscribeModelPicker((request) => {
        if (
          disabled ||
          !focused ||
          (request.sessionId !== undefined && request.sessionId !== sessionId)
        ) {
          return
        }
        seedRevision.current += 1
        setSeed({ ...request, revision: seedRevision.current })
        setDrawerMounted(true)
        setOpen(true)
      }),
    [disabled, focused, sessionId],
  )

  const isGroup = (participants?.length ?? 0) > 1
  const applyPartyRoute = useChatStore((state) => state.applyPartyRoute)
  // The session's model choices: the picker lists agents not invited yet on them.
  const modelChoices = useChatStore((state) => findSessionInState(state, sessionId)?.modelChoices)
  // "All agents" writes the same choice to every listed agent, invited or not; any existing
  // session has one to write, a single agent included.
  const onApplyPartyRoute = useCallback(
    async (choice: PartyRouteChoice, agentIds: readonly string[]): Promise<void> => {
      if (sessionId)
        await applyPartyRoute(sessionId, choice, agentIds).catch(notifyPartyRouteFailure)
    },
    [applyPartyRoute, sessionId],
  )
  // In a group the trigger shows ONE participant's model: the one picked on the roster, or the
  // first (the highest-priority seat) until someone is picked.
  const shown = isGroup
    ? (participants?.find((member) => member.agentId === selectedAgentId) ?? participants?.[0])
    : undefined
  const shownConnection = shown
    ? (connectionsState.connections.find(
        (connection) => connection.id === shown.providerConnectionId,
      ) ?? null)
    : activeConnection
  const shownValue = shown?.modelId ?? value
  // The route's own connection first; a namespaced id whose connection names another provider
  // (an older pick) still finds its model, so the trigger never shows a bare id.
  const selectedModel = useMemo(
    () =>
      findCatalogModelForConnection(
        models,
        connectionsState.connections,
        shownConnection?.id ?? null,
        shownValue,
      ) ??
      liveRouteModel(models, connectionsState.connections, shownValue, shownConnection?.id)?.model,
    [connectionsState.connections, models, shownConnection?.id, shownValue],
  )
  const modelLabel = modelTriggerLabel({
    selectedModel,
    value: shownValue,
    models,
    activeConnection: shownConnection,
  })

  return (
    <div className="flex h-[var(--chrome-control-lg)] min-w-0 max-w-full items-center rounded-lg">
      <Button
        variant="ghost"
        ref={triggerRef}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        aria-label={
          isGroup
            ? `Choose models for ${participants?.length} participants`
            : activeConnection
              ? `Choose model. Current: ${modelLabel} via ${activeConnection.label}`
              : 'Choose a model and connect a provider'
        }
        // Every control in this strip says what it is on hover. The label alone reaches a
        // screen reader and nobody else; the model and turn limit each need their own subject.
        title={
          isGroup
            ? `Models for ${participants?.length} participants`
            : activeConnection
              ? `Model: ${modelLabel} · ${activeConnection.label}`
              : 'Choose a model'
        }
        className="h-[var(--chrome-control-lg)] min-w-0 max-w-72 gap-2 rounded-lg px-2.5 text-xs font-normal"
        onPointerEnter={() => void loadModelPickerDrawer()}
        onFocus={() => void loadModelPickerDrawer()}
        onClick={() => {
          setSeed(null)
          setDrawerMounted(true)
          setOpen(true)
        }}
      >
        <span className="min-w-0 truncate text-left font-medium text-foreground">{modelLabel}</span>
        <ChevronUp className="size-3.5 shrink-0 text-text-faint" />
      </Button>

      {drawerMounted && (
        <Suspense fallback={null}>
          <ModelPickerDrawer
            key={sessionId ?? 'new-session'}
            open={open}
            onOpenChange={setOpen}
            seed={seed}
            models={models}
            connectionsState={connectionsState}
            sessionModelId={value}
            sessionConnectionId={activeId}
            onPickSessionModel={onSelectionChange}
            participants={participants}
            {...(sessionId ? { sessionId, modelChoices: modelChoices ?? NO_CHOICES } : {})}
            participantScope={participantScope}
            reasoningEffort={reasoningEffort}
            onReasoningEffortChange={onReasoningEffortChange}
            initialAgentId={selectedAgentId}
            onAgentTargetChange={onSelectAgent}
            onApplyPartyRoute={sessionId ? onApplyPartyRoute : undefined}
          />
        </Suspense>
      )}
    </div>
  )
})
