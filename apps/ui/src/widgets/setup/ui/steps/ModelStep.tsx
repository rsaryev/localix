import { lazy, Suspense, useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import type { ReasoningEffort } from '@localixai/agent'
import { Button } from '@localixai/kit/button'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { useChatStore } from '@/entities/chat/model/store'
import {
  defaultModelOf,
  defaultProject,
  saveDefaultModel,
} from '@/entities/chat/model/defaultProjectModel'
import { useConnections } from '@/entities/chat/ui/prompt-input/useConnections'
import { LOCAL_PROVIDER_ID } from '@/entities/chat/ui/prompt-input/model-select/LocalConnectPanel'
import { SettingsControlRow, SettingsRows } from '@/features/settings/ui/SettingsScaffold'
import { useModelsCatalog } from '@/shared/hooks/useModelsCatalog'
import { toast } from '@/shared/lib/notify'
import { applyModelPickToOpenChat } from '../../model/applyModelPick'
import { SettingsLink, SetupLater } from '../SetupLater'

const ModelPickerDrawer = lazy(() =>
  import('@/entities/chat/ui/prompt-input/ModelPickerDrawer').then((m) => ({
    default: m.ModelPickerDrawer,
  })),
)

/** Which panel the composer's picker opens on: the model list, or the Local provider's. */
type Seed = { providerId?: string; revision: number }

/**
 * Step one: a connection and the model new conversations start on, through the composer's own picker
 * drawer. The pick is stored where the model chain reads it (the default project), and the empty
 * chat open under the dialog starts on it too.
 */
export function ModelStep() {
  const [seed, setSeed] = useState<Seed | null>(null)
  const [open, setOpen] = useState(false)
  const [effort, setEffort] = useState<ReasoningEffort>('medium')
  const connectionsState = useConnections(null)
  const { models } = useModelsCatalog()
  const projects = useChatStore((s) => s.projects)
  const loadProjects = useChatStore((s) => s.loadProjects)
  const project = defaultProject(projects)
  const current = defaultModelOf(project)
  const runnable = connectionsState.connections.filter((c) => c.hasApiKey)
  const chosen = current && runnable.some((c) => c.id === current.providerConnectionId)
  const chosenName = models.find((m) => m.id === current?.modelId)?.name ?? current?.modelId

  useEffect(() => {
    if (projects.length === 0) void loadProjects()
  }, [projects.length, loadProjects])

  const show = (providerId?: string) => {
    setSeed((prev) => ({ providerId, revision: (prev?.revision ?? 0) + 1 }))
    setOpen(true)
  }

  const pick = async (providerConnectionId: string, modelId: string) => {
    if (!project) return
    try {
      // The project's `projects` topic brings the saved default back to every surface.
      await saveDefaultModel(project.id, { providerConnectionId, modelId })
      await applyModelPickToOpenChat(useChatStore.getState(), {
        providerConnectionId,
        modelId,
        reasoningEffort: effort,
      })
      setOpen(false)
    } catch (error) {
      toast.error('Could not save the model for new conversations', {
        description: errorMessage(error, '') || undefined,
      })
    }
  }

  return (
    <>
      <p className="max-w-prose text-sm leading-6 text-text-soft text-pretty">
        A model answers your conversations. Connect a provider with an API key or a sign-in, or run
        an open model on this computer with no account.
      </p>
      <SettingsRows className="mt-4">
        <SettingsControlRow
          title="Providers"
          description={
            runnable.length > 0
              ? `Connected: ${runnable.map((c) => c.label || c.providerName).join(', ')}.`
              : 'None connected yet.'
          }
        >
          <Button size="xl" variant={runnable.length > 0 ? 'field' : 'mono'} onClick={() => show()}>
            {runnable.length > 0 ? 'Add a provider' : 'Connect a provider'}
          </Button>
        </SettingsControlRow>
        <SettingsControlRow
          title="On this computer"
          description="Download an open model and run it here. Nothing leaves this computer."
        >
          <Button size="xl" variant="field" onClick={() => show(LOCAL_PROVIDER_ID)}>
            Use a local model
          </Button>
        </SettingsControlRow>
        {runnable.length > 0 && (
          <SettingsControlRow
            title="Model for new conversations"
            description={
              chosen ? (
                <span role="status" className="inline-flex items-center gap-1">
                  <Check className="size-3.5 text-status-success" aria-hidden />
                  New conversations start on {chosenName}.
                </span>
              ) : (
                'Not chosen yet: pick one so a new conversation can start.'
              )
            }
          >
            <Button size="xl" variant={chosen ? 'field' : 'mono'} onClick={() => show()}>
              {chosen ? 'Change model' : 'Choose model'}
            </Button>
          </SettingsControlRow>
        )}
      </SettingsRows>
      <SetupLater>
        the model picker in the message box, or <SettingsLink tab="models">Models</SettingsLink>.
      </SetupLater>
      {seed && (
        <Suspense fallback={null}>
          <ModelPickerDrawer
            open={open}
            onOpenChange={setOpen}
            seed={seed}
            models={models}
            connectionsState={connectionsState}
            sessionModelId={current?.modelId ?? ''}
            sessionConnectionId={current?.providerConnectionId ?? null}
            onPickSessionModel={(connectionId, modelId) => pick(connectionId, modelId)}
            reasoningEffort={effort}
            onReasoningEffortChange={setEffort}
          />
        </Suspense>
      )}
    </>
  )
}
