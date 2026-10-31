import { memo, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@localixai/kit/button'
import { ChevronUp } from 'lucide-react'
import { findCatalogModelForConnection, type CatalogModel } from '@localixai/agent/catalog'
import { liveRouteModel } from './model-select/taskReasoning'
import type { useConnections } from './useConnections'
import type { ReasoningEffort } from '../../model/reasoning'
import type { SessionAgentRoute } from '@/shared/api/contracts'
import { modelTriggerLabel } from './modelTriggerLabel'
import { subscribeModelPicker, type ModelPickerRequest } from '@/shared/lib/modelPickerBus'
import { lazyNamed } from '@/shared/lib/lazyNamed'

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
const ModelPickerDrawer = lazyNamed(() => loadModelPickerDrawer(), 'ModelPickerDrawer')

interface ModelSearchSelectProps {
  models: CatalogModel[]
  value: string
  /** Persists the pair as one session update. `agentId` names the agent it is for. */
  onSelectionChange: (
    connectionId: string,
    modelId: string,
    reasoningEffort?: ReasoningEffort,
    agentId?: string,
  ) => void | Promise<void>
  /** The conversation's agent — the workload column lists it and routes it. */
  agent?: SessionAgentRoute | null
  /** Scope for resolving the agent's display name ('' = global). */
  agentScope?: string
  connectionsState: ReturnType<typeof useConnections>
  disabled?: boolean
  reasoningEffort: ReasoningEffort
  onReasoningEffortChange: (effort: ReasoningEffort, agentId?: string) => void
  sessionId: string | null
  focused: boolean
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
  agent,
  agentScope,
  sessionId,
  focused,
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

  // The route's own connection first; a namespaced id whose connection names another provider
  // (an older pick) still finds its model, so the trigger never shows a bare id.
  const selectedModel = useMemo(
    () =>
      findCatalogModelForConnection(
        models,
        connectionsState.connections,
        activeConnection?.id ?? null,
        value,
      ) ?? liveRouteModel(models, connectionsState.connections, value, activeConnection?.id)?.model,
    [activeConnection?.id, connectionsState.connections, models, value],
  )
  const modelLabel = modelTriggerLabel({
    selectedModel,
    value,
    models,
    activeConnection,
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
          activeConnection
            ? `Choose model. Current: ${modelLabel} via ${activeConnection.label}`
            : 'Choose a model and connect a provider'
        }
        // Every control in this strip says what it is on hover. The label alone reaches a
        // screen reader and nobody else; the model and turn limit each need their own subject.
        title={
          activeConnection ? `Model: ${modelLabel} · ${activeConnection.label}` : 'Choose a model'
        }
        className="h-[var(--chrome-control-lg)] min-w-0 max-w-72 gap-1.5 rounded-lg pr-2 pl-1.5 text-xs font-normal"
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
            agent={agent}
            agentScope={agentScope}
            reasoningEffort={reasoningEffort}
            onReasoningEffortChange={onReasoningEffortChange}
          />
        </Suspense>
      )}
    </div>
  )
})
