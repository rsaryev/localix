import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@localixai/kit/button'
import { ChevronDown } from 'lucide-react'
import { findCatalogModelForConnection, type CatalogModel } from '@localixai/agent/catalog'
import type { useConnections } from './useConnections'
import type { ReasoningEffort } from '../../model/reasoning'
import type { SessionAgentRoute } from '@/shared/api/contracts'
import { ModelReasoningControl } from './model-select/ModelReasoningControl'
import { MaxTurnsControl } from './MaxTurnsControl'
import { PermissionModeControl } from './PermissionModeControl'
import { usePermissionMode } from '../../model/usePermissionMode'
import { modelTriggerLabel } from './modelTriggerLabel'
import { subscribeModelPicker, type ModelPickerRequest } from '@/shared/lib/modelPickerBus'
import { useUserSettings } from '@/features/settings/model/useUserSettings'
import { rememberModelReasoning } from './model-select/rememberModelReasoning'

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
  /**
   * How much work one message buys, and how it is changed. User-wide rather than per
   * conversation, deliberately: every addressed agent run reads this
   * one number (`@localixai/api/turn-budget`), and a second per-session copy would be the
   * second source of truth the setting exists to avoid.
   */
  maxTurns?: number
  onMaxTurnsChange?: (next: number) => void
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
  maxTurns,
  onMaxTurnsChange,
}: ModelSearchSelectProps) {
  const { activeConnection, activeId } = connectionsState
  const permissionMode = usePermissionMode(sessionId)
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

  const selectedModel = useMemo(
    () => findCatalogModelForConnection(models, connectionsState.connections, activeId, value),
    [activeId, connectionsState.connections, models, value],
  )

  const modelLabel = modelTriggerLabel({ selectedModel, value, models, activeConnection })
  const showsReasoning = selectedModel?.supportsReasoning ?? false

  return (
    <div className="flex h-[var(--chrome-control-lg)] w-full min-w-0 items-center gap-0.5 rounded-lg">
      <Button
        ref={triggerRef}
        variant="ghost"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        aria-label={
          activeConnection
            ? `Choose model. Current: ${modelLabel} via ${activeConnection.label}`
            : 'Choose a model and connect a provider'
        }
        // Every control in this strip says what it is on hover. The label alone reaches a
        // screen reader and nobody else, and the strip is three unlabelled controls in a row —
        // a model name, a word like "high", and a number — none of which names its own subject.
        title={
          activeConnection ? `Model: ${modelLabel} · ${activeConnection.label}` : 'Choose a model'
        }
        className="flex h-[var(--chrome-control-lg)] min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg border-none bg-transparent px-2.5 text-xs font-normal transition-colors"
        onPointerEnter={() => void loadModelPickerDrawer()}
        onFocus={() => void loadModelPickerDrawer()}
        onClick={() => {
          setSeed(null)
          setDrawerMounted(true)
          setOpen(true)
        }}
      >
        <span className="min-w-0 flex-1 truncate text-left font-medium text-foreground">
          {modelLabel}
        </span>
        {activeConnection && (
          <span className="hidden max-w-32 truncate text-2xs text-text-faint md:inline">
            {activeConnection.label}
          </span>
        )}
        <ChevronDown className="size-3.5 shrink-0 text-text-faint" />
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
            participantScope={participantScope}
            reasoningEffort={reasoningEffort}
            onReasoningEffortChange={onReasoningEffortChange}
          />
        </Suspense>
      )}

      {showsReasoning && (
        <>
          <span className="h-3 w-px shrink-0 bg-control-border/40" aria-hidden />
          <ModelReasoningControl
            modelLabel={modelLabel}
            supportsReasoning
            reasoningEfforts={selectedModel?.reasoningEfforts}
            value={reasoningEffort}
            selected
            disabled={disabled}
            className="font-normal text-text-soft"
            onChange={(effort) => {
              if (!effort || !selectedModel) return
              // The compact control and the details panel must seed subsequent model picks
              // from the same memory; otherwise reopening the picker resurrects the old level.
              rememberModelReasoning(
                {
                  read: () => useUserSettings.getState().settings.agentSettings,
                  write: (next) => useUserSettings.getState().update({ agentSettings: next }),
                },
                'session',
                { providerId: selectedModel.providerId, modelId: selectedModel.id, effort },
              )
              onReasoningEffortChange(effort)
            }}
          />
        </>
      )}

      {/* The neighbouring question: how hard it thinks per reply, then how many replies one
          message may cost. Same strip, because both are the price of pressing send. */}
      {onMaxTurnsChange && (
        <>
          <span className="h-3 w-px shrink-0 bg-control-border/40" aria-hidden />
          <MaxTurnsControl value={maxTurns} onChange={onMaxTurnsChange} disabled={disabled} />
        </>
      )}

      {/* And whether it stops to ask: the conversation's permission mode. */}
      {sessionId && (
        <>
          <span className="h-3 w-px shrink-0 bg-control-border/40" aria-hidden />
          <PermissionModeControl
            value={permissionMode.mode}
            editable={permissionMode.editable}
            onChange={permissionMode.setMode}
            waitingPlan={permissionMode.waitingPlan}
            onApprovePlan={permissionMode.approvePlan}
            disabled={disabled}
          />
        </>
      )}
    </div>
  )
})
