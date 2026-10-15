import { lazy, Suspense, useEffect, useState } from 'react'
import { ChevronUp, Link2, Search, UserPlus, X } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import type { ReasoningEffort } from '@localixai/agent'
import { useChatStore } from '@/features/chat/model/store'
import {
  defaultModelOf,
  defaultProject,
  saveDefaultModel,
} from '@/features/chat/model/defaultProjectModel'
import { useConnections } from '@/features/chat/ui/prompt-input/useConnections'
import { useModelsCatalog } from '@/shared/hooks/useModelsCatalog'
import { providerIcon } from '@/shared/ui/providerPresentation'
import './model-scene.css'

const ModelPickerDrawer = lazy(() =>
  import('@/features/chat/ui/prompt-input/ModelPickerDrawer').then((m) => ({
    default: m.ModelPickerDrawer,
  })),
)

/** The picker's provider column, in the order it lists them. */
const PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic' },
  { id: 'github-copilot', name: 'GitHub Copilot' },
  { id: 'openai', name: 'OpenAI' },
  { id: 'openrouter', name: 'OpenRouter' },
]

/**
 * The real flow, in miniature: "Choose model" in the composer opens the picker drawer,
 * a provider is picked, a key goes in, Add Connection unlocks the model list, and the
 * composer then names the chosen model. Model names come from the user's own catalog.
 */
export function ModelScene() {
  const { models } = useModelsCatalog()
  const names = models
    .filter((m) => m.providerId === 'anthropic')
    .slice(0, 3)
    .map((m) => m.name)
  const picked = names[0] ?? 'Claude'

  return (
    <div aria-hidden className="wt-model">
      <div className="wt-pane wt-composer">
        <div className="wt-composer-party">
          <span className="wt-avatar">LO</span> Localix <X className="size-2" />
          <UserPlus className="ml-1 size-2.5 text-text-faint" />
        </div>
        <span className="wt-swap wt-composer-text">
          <span className="wt-ph-a">Connect a provider in the app to start…</span>
          <span className="wt-ph-b">Describe the outcome you want…</span>
        </span>
        <span className="wt-choose">
          <span className="wt-swap">
            <span className="wt-ph-a">Choose model</span>
            <span className="wt-ph-b">{picked}</span>
          </span>
          <ChevronUp className="size-2.5" />
        </span>
      </div>

      <div className="wt-pane wt-drawer">
        <span className="wt-grip" />
        <div className="wt-cols">
          <div className="wt-col">
            <span className="wt-label">Workload</span>
            <span className="wt-label wt-sub">Agents</span>
            <span className="wt-row wt-selected">Localix</span>
          </div>
          <div className="wt-col">
            <span className="wt-label">Provider</span>
            <span className="wt-row wt-field">
              <Search /> Search providers…
            </span>
            {PROVIDERS.map(({ id, name }) => {
              const Icon = providerIcon(id)
              return (
                <span key={id} className="wt-row" data-pick={id === 'anthropic' || undefined}>
                  <Icon /> {name}
                </span>
              )
            })}
          </div>
          <div className="wt-col wt-col-main">
            <div className="wt-connect">
              <span className="wt-label">Anthropic</span>
              <span className="wt-oauth">Anthropic (Claude Pro/Max)</span>
              <span className="wt-or">or</span>
              <span className="wt-row wt-field">
                <span className="wt-key" />
                <span className="wt-caret" />
              </span>
              <span className="wt-add">
                <Link2 className="size-2.5" /> Add Connection
              </span>
            </div>
            <div className="wt-models">
              <span className="wt-label">Models</span>
              {(names.length > 0 ? names : [picked]).map((name, i) => (
                <span key={name} className="wt-row" data-first={i === 0 || undefined}>
                  {name}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Opens the composer's own picker; the pick becomes what new chats start on. */
export function ModelAction() {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [effort, setEffort] = useState<ReasoningEffort>('medium')
  const connectionsState = useConnections(null)
  const { models } = useModelsCatalog()
  const projects = useChatStore((s) => s.projects)
  const loadProjects = useChatStore((s) => s.loadProjects)
  const project = defaultProject(projects)
  const current = defaultModelOf(project)
  const currentName = models.find((m) => m.id === current?.modelId)?.name

  useEffect(() => {
    if (projects.length === 0) void loadProjects()
  }, [projects.length, loadProjects])

  const pick = async (providerConnectionId: string, modelId: string) => {
    if (!project) return
    const updated = await saveDefaultModel(project.id, { providerConnectionId, modelId })
    const store = useChatStore.getState()
    store._hydrateProjects(store.projects.map((p) => (p.id === updated.id ? updated : p)))
  }

  return (
    <div className="flex items-center gap-3">
      <Button
        variant="mono"
        size="lg"
        onClick={() => {
          setMounted(true)
          setOpen(true)
        }}
      >
        {current ? 'Change model' : 'Choose model'}
      </Button>
      {currentName ? (
        <span className="text-xs text-text-faint">New chats start on {currentName}</span>
      ) : null}
      {mounted ? (
        <Suspense fallback={null}>
          <ModelPickerDrawer
            open={open}
            onOpenChange={setOpen}
            seed={null}
            models={models}
            connectionsState={connectionsState}
            sessionModelId={current?.modelId ?? ''}
            sessionConnectionId={current?.providerConnectionId ?? null}
            onPickSessionModel={(connectionId, modelId) => pick(connectionId, modelId)}
            reasoningEffort={effort}
            onReasoningEffortChange={setEffort}
          />
        </Suspense>
      ) : null}
    </div>
  )
}
