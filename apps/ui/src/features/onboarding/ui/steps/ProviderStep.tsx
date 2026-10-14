import { useEffect, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { useChatStore } from '@/features/chat/model/store'
import { ModelBrowser } from '@/features/chat/ui/prompt-input/model-select/ModelBrowser'
import { useConnections } from '@/features/chat/ui/prompt-input/useConnections'
import { useModelsCatalog } from '@/shared/hooks/useModelsCatalog'
import { saveStartupModel, startupProject } from '../../model/startupModel'
import type { OnboardingStepProps } from '../../model/types'
import { StepHeader } from '../StepHeader'
import { StepActions } from '../wizard/StepActions'
import { useProviderPick } from './useProviderPick'

/**
 * The workspace model picker, embedded without a second onboarding-only
 * provider flow. `ModelBrowser` owns provider discovery, connection management,
 * workload routing and model selection in both surfaces; this wrapper only
 * remembers the session pair that the first chat should use, and adds the two
 * thing a first run needs on top: a stated consequence for Continue.
 */
export function ProviderStep({ onComplete }: OnboardingStepProps) {
  const { models } = useModelsCatalog()
  // App-level: the step stores the pair on the project, and connecting re-routes no chat.
  const connectionsState = useConnections(null)
  const { connections } = connectionsState
  const refreshConnections = useChatStore((state) => state.refreshConnections)
  const projects = useChatStore((state) => state.projects)
  const loadProjects = useChatStore((state) => state.loadProjects)
  const [saveFailed, setSaveFailed] = useState(false)

  // The choice is stored on the project, so the project list has to be here before Continue can
  // commit it. A direct visit to `/setup` can precede workspace hydration, exactly as the
  // connections can.
  useEffect(() => {
    if (projects.length === 0) void loadProjects()
  }, [projects.length, loadProjects])

  // A direct visit to `/setup` may precede workspace hydration. Populate the
  // same connection store ModelBrowser uses before resolving the remembered pair.
  useEffect(() => {
    void refreshConnections()
  }, [refreshConnections])

  const { selected, setPickedSlot, focusConnection } = useProviderPick({ connections })

  // Which provider the picker should OPEN on. `ModelBrowser` initializes its
  // sidebar once per mount, and on a cold `/setup` the connection list can arrive
  // after that — so the picker would open on an arbitrary "add provider" form
  // while a working connection sat one row above. Latched at the first answer and
  // never re-seeded, so a connection added later can't yank the pane out from
  // under the user (the browser has its own jump-to-fresh-connection handling).
  const [openOnProvider, setOpenOnProvider] = useState<string | null>(null)
  useEffect(() => {
    if (!openOnProvider && focusConnection) setOpenOnProvider(focusConnection.providerId)
  }, [openOnProvider, focusConnection])

  const initialProviderId = openOnProvider ?? undefined

  /**
   * Commit the pair to the project, then move on.
   *
   * The write is awaited and a failure KEEPS the step: the next screen states what the first
   * chat will run on, and advancing past a save that did not happen would state something
   * untrue. It used to be a localStorage write, which cannot fail and cannot be read by the
   * server either.
   */
  const continueWithSelectedModel = async () => {
    const project = startupProject(projects)
    if (!selected || !project) return
    try {
      const updated = await saveStartupModel(project.id, selected)
      useChatStore
        .getState()
        ._hydrateProjects(
          projects.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
        )
      setSaveFailed(false)
      onComplete()
    } catch {
      setSaveFailed(true)
    }
  }

  return (
    <div className="flex w-full flex-col gap-5">
      <StepHeader
        title="Connect and choose a model"
        subtitle="Sign in or paste an API key, then pick the model your chats start with. Every other workload can be routed here too — or later, from the same picker in the workspace."
      />

      <ModelBrowser
        key={initialProviderId ?? 'cold'}
        models={models}
        connectionsState={connectionsState}
        initialProviderId={initialProviderId}
        sessionModelId={selected?.modelId ?? ''}
        sessionConnectionId={selected?.providerConnectionId ?? null}
        reasoningEffort={selected?.reasoningEffort}
        onReasoningEffortChange={(reasoningEffort) => {
          if (selected) setPickedSlot({ ...selected, reasoningEffort })
        }}
        onPickSessionModel={(connectionId, modelId, reasoningEffort) =>
          setPickedSlot({ providerConnectionId: connectionId, modelId, reasoningEffort })
        }
        // Tall enough to browse a long catalog, short enough that
        // Continue stays on screen on a laptop (the step used to run
        // past the fold, so the action you needed was below it).
        heightClassName="h-[min(46rem,calc(100dvh-19rem))] min-h-[30rem] w-full rounded-2xl border border-control-border/80"
      />

      {saveFailed ? (
        <p className="text-xs text-status-error">
          Could not save the model for this workspace. Check the connection and try Continue again.
        </p>
      ) : null}

      <StepActions
        align="end"
        disabled={!selected}
        onClick={() => void continueWithSelectedModel()}
      >
        Continue <ArrowRight className="size-4" />
      </StepActions>
    </div>
  )
}
