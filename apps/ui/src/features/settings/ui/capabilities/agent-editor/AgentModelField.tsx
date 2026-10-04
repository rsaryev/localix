import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { findCatalogModel } from '@localixai/agent/catalog'
import { useChatStore } from '@/features/chat/model/store'
import { ModelPickerShell } from '@/features/chat/ui/prompt-input/model-select/ModelPickerShell'
import { useConnections } from '@/features/chat/ui/prompt-input/useConnections'
import { REASONING_OPTIONS } from '@/features/chat/model/reasoning'
import { useModelsCatalog } from '@/shared/hooks/useModelsCatalog'
import { Button } from '@localixai/kit/button'
import { Field } from '@localixai/kit/field'
import { IconButton } from '@localixai/kit/icon-button'
import { Select } from '@localixai/kit/select'

const EFFORT_OPTIONS = [
  { value: '', label: 'Inherit effort' },
  ...REASONING_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
]

interface AgentModelFieldProps {
  provider: string
  model: string
  effort: string
  disabled?: boolean
  onChange: (next: { provider: string; model: string }) => void
  onEffortChange: (effort: string) => void
}

/**
 * The agent's model, chosen in the SAME browser the chat composer and onboarding use.
 *
 * What it stores is a provider TYPE + model, never the connection that was clicked: a
 * definition file travels, connection ids do not, and one provider may have several. So the
 * pick maps `connectionId → providerId` here and forgets the connection. The task column is
 * off — a click on another workload row inside this form would rewrite live routing.
 */
export function AgentModelField({
  provider,
  model,
  effort,
  disabled,
  onChange,
  onEffortChange,
}: AgentModelFieldProps) {
  const { models } = useModelsCatalog()
  // The agent editor belongs to no chat: a provider connected from here routes none.
  const connectionsState = useConnections(null)
  const { connections } = connectionsState
  const refreshConnections = useChatStore((state) => state.refreshConnections)
  const [open, setOpen] = useState(false)

  // Settings may be opened before the workspace hydrated the connection store.
  useEffect(() => {
    void refreshConnections()
  }, [refreshConnections])

  const catalogModel = useMemo(
    () => findCatalogModel(models, provider || null, model || null),
    [models, provider, model],
  )
  // The browser's checkmark wants a connection; any live one of the pinned provider will do.
  const representativeConnection = useMemo(
    () => connections.find((connection) => connection.providerId === provider) ?? null,
    [connections, provider],
  )
  const connectionProvider = useMemo(
    () => new Map(connections.map((connection) => [connection.id, connection.providerId])),
    [connections],
  )

  const summary = model
    ? `${catalogModel?.providerName ?? provider ?? ''}${catalogModel || provider ? ' · ' : ''}${catalogModel?.name ?? model}`
    : 'Inherit the session model'
  const supportsReasoning = catalogModel?.supportsReasoning ?? Boolean(model)

  return (
    // Labels and controls share rows across both columns; the explanatory line sits below the
    // row, so a longer note under one field can never push its control out of line with the
    // other. Effort disables itself while the configured default model does no reasoning.
    <div className="grid grid-cols-[minmax(0,1fr)_10rem] items-start gap-x-3 gap-y-1.5 @max-md:grid-cols-1">
      <Field label="Model" optional>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="lg"
            // Same geometry as the `lg` Select beside it (the Button `lg` scale is one step
            // shorter and a size smaller in type), so the two controls share one row exactly.
            className="h-[var(--chrome-control-xl)] min-w-0 flex-1 justify-between px-3 text-sm font-normal"
            aria-haspopup="dialog"
            aria-expanded={open}
            disabled={disabled}
            onClick={() => setOpen(true)}
          >
            <span className="min-w-0 truncate text-left">{summary}</span>
            <ChevronDown className="size-3.5 shrink-0 text-text-faint" />
          </Button>
          {model && (
            <IconButton
              size="md"
              aria-label="Clear model — inherit the session model"
              tooltip="Inherit the session model"
              disabled={disabled}
              onClick={() => onChange({ provider: '', model: '' })}
            >
              <X />
            </IconButton>
          )}
        </div>
      </Field>

      <Field label="Effort" optional disabled={disabled || !supportsReasoning}>
        <Select
          size="xl"
          className="w-full"
          value={effort}
          onValueChange={onEffortChange}
          options={EFFORT_OPTIONS}
          disabled={disabled || !supportsReasoning}
          aria-label="Reasoning effort"
        />
      </Field>
      <p className="text-xs/relaxed text-text-faint @max-md:col-span-1 col-span-2">
        {model && !provider
          ? 'An alias or bare id: resolved on the connection the run inherits.'
          : model
            ? 'Stored as provider + model, never a connection; several connections to one provider stay interchangeable.'
            : 'Leave empty to run on whatever model the calling session uses.'}
      </p>

      <ModelPickerShell
        open={open}
        onOpenChange={setOpen}
        title="Choose the agent's model"
        models={models}
        connectionsState={connectionsState}
        taskColumn={false}
        initialProviderId={provider || undefined}
        sessionModelId={model}
        sessionConnectionId={representativeConnection?.id ?? null}
        onPickSessionModel={(connectionId, modelId) => {
          onChange({
            provider: connectionProvider.get(connectionId) ?? '',
            model: modelId,
          })
          setOpen(false)
        }}
      />
    </div>
  )
}
